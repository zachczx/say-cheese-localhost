<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  import {
    runCaptureJob,
    type CaptureFailure,
    type CaptureJobResult,
    type ShotStatus,
  } from '../capture/job';
  import { DEFAULT_TIMEZONE, type ColorScheme } from '../capture/emulation';
  import type { ImageFormat } from '../capture/screenshot';
  import { runFolderName } from '../storage/run-folder';
  import { closeOrphanedCaptureWindows } from '../capture/orphans';
  import { normalizeLocalBaseUrl } from '../capture/url';
  import { pingAddress, type PingResult } from '../capture/ping';
  import { PROFILES } from '../profiles';
  import type { CaptureProfile, Shot } from '../profiles/schema';
  import { VIEWPORTS } from '../profiles/viewports';
  import {
    loadPreferences,
    normalizePreferences,
    savePreferences,
    type Preferences,
  } from '../storage/preferences';
  import { loadCaptureLog, saveCaptureLog, type CaptureLog } from '../storage/captures';
  import {
    DEFAULT_PAGE_ZOOM_PERCENT,
    MAX_PAGE_ZOOM_PERCENT,
    MIN_PAGE_ZOOM_PERCENT,
  } from '../capture/zoom';
  import IconCamera from '~icons/lucide/camera';
  import IconDownload from '~icons/lucide/download';
  import IconInfo from '~icons/lucide/info';
  import ConnectionStatus from './components/ConnectionStatus.svelte';
  import ManualPreparation from './components/ManualPreparation.svelte';
  import PreviewDialog from './components/PreviewDialog.svelte';
  import RunStatus from './components/RunStatus.svelte';
  import ShotQueue from './components/ShotQueue.svelte';
  import { statusLabels, type ShotState } from './status';

  const initialProfile = PROFILES[0] as CaptureProfile;

  let profile = $state<CaptureProfile>(initialProfile);
  let profileId = $state(initialProfile.id);
  let baseUrl = $state(initialProfile.defaultBaseUrl);
  let baseUrlInvalid = $state(false);
  let baseUrlError = $state('');
  let pinging = $state(false);
  let pingResult = $state<PingResult | undefined>();
  let pingAbortController: AbortController | undefined;
  let pingDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let viewportId = $state(initialProfile.defaultViewport);
  let extraViewportIds = $state<string[]>([]);
  let pageZoomPercent = $state(DEFAULT_PAGE_ZOOM_PERCENT);
  let colorScheme = $state<ColorScheme>('system');
  let imageFormat = $state<ImageFormat>('webp');
  let separateRunFolders = $state(false);
  let lastRunFolder = $state<string>();
  let pageZoomInput = $state(String(DEFAULT_PAGE_ZOOM_PERCENT));
  let pageZoomInvalid = $state(false);
  let pageZoomError = $state('');
  let continueOnError = $state(true);
  let retainWindow = $state(false);
  let captureBeyondViewport = $state(false);
  let fullPageCapture = $state(false);
  let selectedIds = $state(defaultShotIds(initialProfile));
  let shotStates = $state<Record<string, ShotState>>(createShotStates(initialProfile));
  let preferences: Preferences | undefined;
  let abortController: AbortController | undefined;
  let manual = $state(true);
  let manualShot = $state<Shot>();
  let manualSaved = $state(false);
  let manualError = $state('');
  let warnings = $state<string[]>([]);
  // Last image saved for each shot in this controller session, as a data URL.
  let previews = $state<Record<string, string>>({});
  // When each shot was last saved, across sessions. Keyed by profile, then shot.
  let captureLog = $state<CaptureLog>({});
  let captureLogWriteQueue = Promise.resolve();
  let previewShotId = $state<string>();
  let previewDialog = $state<ReturnType<typeof PreviewDialog>>();
  let chooseManual: ((action: 'capture' | 'next') => void) | undefined;
  let ready = $state(false);
  let running = $state(false);
  let stopping = $state(false);
  let lastRunShotIds = $state<string[]>([]);
  // False while extra viewport passes remain, so their last shot does not read "Finish".
  let onFinalPass = $state(true);
  let progressCompleted = $state(0);
  let progressTotal = $state(initialProfile.shots.length);
  let currentUrl = $state('Ready to capture');
  let jobStatus = $state<ShotStatus>('pending');
  let jobStatusLabel = $state('Idle');
  let errorMessage = $state('');
  let settingsError = $state('');
  let footerSummary = $state('Images overwrite matching files without prompting.');
  let preferenceWriteQueue = Promise.resolve();

  const selectedCount = $derived(selectedIds.length);
  // Shots from the last run that neither saved nor were deliberately skipped.
  const unfinishedShotIds = $derived(
    lastRunShotIds.filter(
      (id) => !['complete', 'skipped'].includes(shotStates[id]?.status ?? 'pending'),
    ),
  );
  const manualIsLastShot = $derived(
    manualShot !== undefined && onFinalPass && lastRunShotIds.at(-1) === manualShot.id,
  );
  const previewShot = $derived(profile.shots.find((shot) => shot.id === previewShotId));
  const viewport = $derived(
    VIEWPORTS.find((candidate) => candidate.id === viewportId) ?? VIEWPORTS[0],
  );
  // Extra viewports, in preset order, never including the main viewport.
  const extraViewports = $derived(
    VIEWPORTS.filter(
      (candidate) => candidate.id !== viewportId && extraViewportIds.includes(candidate.id),
    ),
  );

  onMount(() => {
    void initialize();
  });

  // Alt+Shift+C (or the user's own binding) reaches the controller from the
  // background worker while the capture window has focus.
  let captureShortcut = $state('');
  function handleRuntimeMessage(message: unknown): void {
    if ((message as { type?: string } | undefined)?.type !== 'capture-current-view') return;
    if (manualShot) chooseManual?.('capture');
  }
  chrome.runtime?.onMessage?.addListener(handleRuntimeMessage);
  void chrome.commands
    ?.getAll?.()
    .then((commands) => {
      captureShortcut =
        commands.find((command) => command.name === 'capture-current-view')?.shortcut ?? '';
    })
    .catch(() => undefined);

  onDestroy(() => {
    clearPreviews();
    chrome.runtime?.onMessage?.removeListener(handleRuntimeMessage);
    abortController?.abort();
    pingAbortController?.abort();
    clearTimeout(pingDebounceTimer);
  });

  function awaitManualCapture(shot: Shot, signal: AbortSignal): Promise<'capture' | 'next'> {
    if (signal.aborted) return Promise.reject(signal.reason);
    manualShot = shot;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener('abort', abort);
        chooseManual = undefined;
        manualShot = undefined;
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      chooseManual = (action) => {
        cleanup();
        manualError = '';
        warnings = [];
        resolve(action);
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  async function initialize(): Promise<void> {
    try {
      applyPreferences(await loadPreferences());
    } catch {
      applyPreferences({});
      settingsError = 'Saved settings could not be loaded. Safe defaults are active.';
    }
    try {
      captureLog = await loadCaptureLog();
    } catch {
      captureLog = {};
    }
    try {
      const currentTabId = (await chrome.tabs.getCurrent?.())?.id;
      await closeOrphanedCaptureWindows(currentTabId);
    } catch {
      // Cleanup is best-effort; the controller still works without it.
    } finally {
      ready = true;
      scheduleAutoPing(0);
    }
  }

  function applyPreferences(stored: Partial<Preferences>): void {
    const loadedPreferences = normalizePreferences(stored, PROFILES, VIEWPORTS);
    const storedProfile =
      PROFILES.find((candidate) => candidate.id === loadedPreferences.profileId) ?? initialProfile;
    profile = storedProfile;
    profileId = storedProfile.id;
    preferences = loadedPreferences;
    viewportId = loadedPreferences.viewportId;
    baseUrl = loadedPreferences.baseUrls[storedProfile.id] ?? storedProfile.defaultBaseUrl;
    clearTimeout(pingDebounceTimer);
    pingAbortController?.abort();
    pingResult = undefined;
    continueOnError = loadedPreferences.continueOnError;
    retainWindow = loadedPreferences.retainWindowAfterFailure;
    captureBeyondViewport = loadedPreferences.captureBeyondViewport;
    fullPageCapture = loadedPreferences.fullPageCapture;
    manual = loadedPreferences.manualPreparation;
    pageZoomPercent = loadedPreferences.pageZoomPercent;
    pageZoomInput = String(loadedPreferences.pageZoomPercent);
    colorScheme = loadedPreferences.colorScheme;
    imageFormat = loadedPreferences.imageFormat;
    separateRunFolders = loadedPreferences.separateRunFolders;
    extraViewportIds = loadedPreferences.extraViewportIds;
    pageZoomInvalid = false;
    pageZoomError = '';
    selectedIds =
      loadedPreferences.selectedShots[storedProfile.id] ?? defaultShotIds(storedProfile);
    resetShotStates();
  }

  function switchProfile(nextProfileId: string): void {
    if (running || !preferences) return;
    const next = PROFILES.find((candidate) => candidate.id === nextProfileId);
    if (!next) return;

    profile = next;
    profileId = next.id;
    preferences.profileId = next.id;
    clearPreviews();
    baseUrl = preferences.baseUrls[next.id] ?? next.defaultBaseUrl;
    baseUrlInvalid = false;
    baseUrlError = '';
    clearTimeout(pingDebounceTimer);
    pingAbortController?.abort();
    pingResult = undefined;
    viewportId = next.defaultViewport;
    preferences.viewportId = next.defaultViewport;
    selectedIds = preferences.selectedShots[next.id] ?? defaultShotIds(next);
    resetShotStates();
    hideError();
    void persist();
    scheduleAutoPing(0);
  }

  function updateBaseUrl(value: string): void {
    baseUrl = value;
    clearTimeout(pingDebounceTimer);
    pingAbortController?.abort();
    pingResult = undefined;
    const valid = validateBaseUrl(false);
    if (!preferences) return;
    preferences.baseUrls[profile.id] = value;
    void persist();
    if (valid) {
      scheduleAutoPing(300);
    }
  }

  function isBaseUrlValid(): boolean {
    try {
      normalizeLocalBaseUrl(baseUrl);
      return true;
    } catch {
      return false;
    }
  }

  function scheduleAutoPing(delayMs = 300): void {
    clearTimeout(pingDebounceTimer);
    if (running) return;
    if (!isBaseUrlValid()) {
      pingAbortController?.abort();
      pingResult = undefined;
      pinging = false;
      return;
    }
    pingDebounceTimer = setTimeout(() => {
      void runPing();
    }, delayMs);
  }

  async function runPing(): Promise<void> {
    clearTimeout(pingDebounceTimer);
    if (running || !isBaseUrlValid()) return;
    pingAbortController?.abort();
    const currentAbort = new AbortController();
    pingAbortController = currentAbort;
    const targetUrl = baseUrl;
    pinging = true;
    try {
      const result = await pingAddress(targetUrl, { signal: currentAbort.signal });
      if (!currentAbort.signal.aborted && baseUrl === targetUrl) {
        pingResult = result;
        if (result && !result.reachable) scheduleAutoPing(30_000);
      }
    } finally {
      if (pingAbortController === currentAbort) {
        pinging = false;
      }
    }
  }

  function toggleExtraViewport(id: string, checked: boolean): void {
    extraViewportIds = checked
      ? [...new Set([...extraViewportIds, id])]
      : extraViewportIds.filter((candidate) => candidate !== id);
    if (!preferences) return;
    preferences.extraViewportIds = [...extraViewportIds];
    void persist();
  }

  function updateViewport(nextViewportId: string): void {
    viewportId = nextViewportId;
    if (!preferences) return;
    preferences.viewportId = nextViewportId;
    void persist();
  }

  function updateColorScheme(value: string): void {
    colorScheme = value === 'light' || value === 'dark' ? value : 'system';
    if (!preferences) return;
    preferences.colorScheme = colorScheme;
    void persist();
  }

  function updateImageFormat(value: string): void {
    imageFormat = value === 'png' ? 'png' : 'webp';
    if (!preferences) return;
    preferences.imageFormat = imageFormat;
    void persist();
  }

  function updatePageZoom(value: string): void {
    pageZoomInput = value;
    if (!validatePageZoom(false) || !preferences) return;
    preferences.pageZoomPercent = pageZoomPercent;
    void persist();
  }

  function updateContinueOnError(value: boolean): void {
    continueOnError = value;
    if (!preferences) return;
    preferences.continueOnError = value;
    void persist();
  }

  function updateSeparateRunFolders(value: boolean): void {
    separateRunFolders = value;
    if (!preferences) return;
    preferences.separateRunFolders = value;
    void persist();
  }

  function updateRetainWindow(value: boolean): void {
    retainWindow = value;
    if (!preferences) return;
    preferences.retainWindowAfterFailure = value;
    void persist();
  }

  function updateCaptureBeyondViewport(value: boolean): void {
    captureBeyondViewport = value;
    if (!preferences) return;
    preferences.captureBeyondViewport = value;
    void persist();
  }

  function updateManualPreparation(value: boolean): void {
    manual = value;
    if (!preferences) return;
    preferences.manualPreparation = value;
    void persist();
  }

  function updateFullPageCapture(value: boolean): void {
    fullPageCapture = value;
    if (!preferences) return;
    preferences.fullPageCapture = value;
    void persist();
  }

  function toggleShot(shotId: string, checked: boolean): void {
    const next = checked
      ? selectedIds.includes(shotId)
        ? selectedIds
        : [...selectedIds, shotId]
      : selectedIds.filter((id) => id !== shotId);
    setSelection(profile.shots.filter((shot) => next.includes(shot.id)).map((shot) => shot.id));
  }

  function toggleAll(checked: boolean): void {
    setSelection(checked ? profile.shots.map((shot) => shot.id) : []);
  }

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    // Closing the controller mid-run abandons the capture. Ask first.
    if (!running) return;
    event.preventDefault();
    event.returnValue = '';
  }

  function handleKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && manualShot) {
      event.preventDefault();
      chooseManual?.('capture');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && ready && !running) {
      event.preventDefault();
      void startCapture(selectedShots());
    }
  }

  // A full-resolution data URL holds several MB of base64 per shot for the whole
  // session. A Blob keeps the bytes once, and its object URL is revoked when replaced.
  async function showPreview(shotId: string, dataUrl: string): Promise<void> {
    let url = dataUrl;
    try {
      url = URL.createObjectURL(await (await fetch(dataUrl)).blob());
    } catch {
      // Fall back to the data URL; the preview still works, it just costs more memory.
    }
    const previous = previews[shotId];
    previews[shotId] = url;
    if (previous) URL.revokeObjectURL(previous);
  }

  function clearPreviews(): void {
    for (const url of Object.values(previews)) URL.revokeObjectURL(url);
    previews = {};
  }

  async function startCapture(shots: Shot[]): Promise<void> {
    if (running || shots.length === 0 || !validateBaseUrl(true) || !validatePageZoom(true)) return;
    lastRunShotIds = shots.map((shot) => shot.id);
    const runFolder = separateRunFolders ? runFolderName() : undefined;
    lastRunFolder = runFolder;
    for (const shot of shots) {
      shotStates[shot.id] = { status: 'pending' };
    }
    abortController = new AbortController();
    clearTimeout(pingDebounceTimer);
    pingAbortController?.abort();
    pinging = false;
    running = true;
    stopping = false;
    hideError();
    manualSaved = false;
    manualError = '';
    warnings = [];
    // One pass per viewport. A single viewport keeps today's paths unchanged; with
    // extras, each viewport writes into its own folder so file names never collide.
    const passes = [viewport, ...extraViewports];
    const multiViewport = passes.length > 1;
    const total = shots.length * passes.length;
    setProgress(0, total);
    setJobStatus('preparing', 'Opening capture window');
    currentUrl = 'Preparing localhost target…';
    const failuresByShot: Record<string, CaptureFailure[]> = {};
    // A later pass can succeed where an earlier one failed, or throw before it
    // reports. Keep every failure visible either way.
    const showEveryFailure = () => {
      for (const [shotId, failures] of Object.entries(failuresByShot)) {
        shotStates[shotId] = {
          status: 'failed',
          error: failures.map((failure) => failure.message).join(' '),
        };
      }
    };

    try {
      const result: CaptureJobResult = {
        completed: 0,
        skipped: 0,
        failures: [],
        stopped: false,
        windowRetained: false,
      };
      for (const [passIndex, pass] of passes.entries()) {
        if (abortController.signal.aborted) {
          result.stopped = true;
          break;
        }
        const offset = passIndex * shots.length;
        onFinalPass = passIndex === passes.length - 1;
        const subdirectory = [runFolder, multiViewport ? pass.id : undefined]
          .filter(Boolean)
          .join('/');
        const passResult = await runCaptureJob({
          profile,
          baseUrl,
          viewport: pass,
          shots,
          continueOnError,
          retainWindowAfterFailure: retainWindow,
          outputSubdirectory: subdirectory || undefined,
          captureBeyondViewport,
          fullPage: fullPageCapture,
          pageZoomPercent,
          colorScheme,
          format: imageFormat,
          signal: abortController.signal,
          onManualReady: manual ? awaitManualCapture : undefined,
          onWarnings: (value) => {
            warnings = value;
          },
          onShotSaved: (shotId, dataUrl) => {
            void showPreview(shotId, dataUrl);
            recordCapture(shotId, pass.id);
          },
          onShotUpdate(update) {
            if (update.status === 'navigating') {
              manualSaved = false;
              manualError = '';
            }
            if (update.status === 'complete') manualSaved = true;
            if (manual && update.status === 'failed')
              manualError = update.detail ?? 'Capture failed.';
            shotStates[update.shotId] = { status: update.status, error: update.detail };
            currentUrl = update.currentUrl;
            setJobStatus(
              update.status,
              multiViewport
                ? `${statusLabels[update.status]} · ${pass.label.split(' — ')[0]}`
                : statusLabels[update.status],
            );
          },
          onProgress: (completed) => setProgress(offset + completed, total),
        });
        result.completed += passResult.completed;
        result.skipped = (result.skipped ?? 0) + (passResult.skipped ?? 0);
        result.windowRetained ||= passResult.windowRetained;
        for (const failure of passResult.failures) {
          const labelled = multiViewport
            ? { ...failure, message: `${pass.label}: ${failure.message}` }
            : failure;
          result.failures.push(labelled);
          failuresByShot[failure.shotId] = [...(failuresByShot[failure.shotId] ?? []), labelled];
        }
        if (passResult.stopped) {
          result.stopped = true;
          break;
        }
        if (passResult.failures.length > 0 && !continueOnError) break;
      }
      showEveryFailure();

      if (result.stopped) {
        setJobStatus('failed', 'Stopped');
        footerSummary = `Stopped after ${result.completed} completed ${result.completed === 1 ? 'shot' : 'shots'}.`;
      } else if (result.failures.length > 0) {
        const count = result.failures.length;
        setJobStatus('failed', `${count} failed`);
        showError(
          `${count} ${count === 1 ? 'shot' : 'shots'} failed. Each reason is shown in the shot queue.`,
        );
        footerSummary = result.windowRetained
          ? 'The capture window was left open for inspection.'
          : 'Completed shots were downloaded; failed shots can be retried.';
      } else {
        setJobStatus('complete', 'Complete');
        currentUrl = result.skipped
          ? `${result.skipped} shots skipped`
          : 'All selected shots finished';
        footerSummary = `${result.completed} ${result.completed === 1 ? 'image' : 'images'} saved to Downloads/${profile.outputDirectory}/${runFolder ? `${runFolder}/` : ''}${multiViewport ? ` in ${passes.length} viewport folders` : ''}`;
      }
    } catch (error) {
      showEveryFailure();
      const message = error instanceof Error ? error.message : String(error);
      setJobStatus('failed', 'Capture failed');
      showError(message);
      footerSummary = 'Capture did not finish. Previously saved files remain in Downloads.';
    } finally {
      running = false;
      stopping = false;
      abortController = undefined;
      manualShot = undefined;
      chooseManual = undefined;
      scheduleAutoPing(0);
    }
  }

  function retryUnfinished(): void {
    const retryShots = profile.shots.filter((shot) => unfinishedShotIds.includes(shot.id));
    void startCapture(retryShots);
  }

  function stopCapture(): void {
    abortController?.abort(new DOMException('Capture stopped.', 'AbortError'));
    stopping = true;
    setJobStatus('preparing', 'Stopping safely');
  }

  function setSelection(ids: string[]): void {
    if (running) return;
    selectedIds = ids;
    if (!preferences) return;
    preferences.selectedShots[profile.id] = [...ids];
    void persist();
  }

  function resetShotStates(): void {
    shotStates = createShotStates(profile);
    setProgress(0, profile.shots.length);
    setJobStatus('pending', 'Idle');
    currentUrl = 'Ready to capture';
  }

  function setProgress(completed: number, total: number): void {
    progressCompleted = completed;
    progressTotal = total;
  }

  function setJobStatus(status: ShotStatus, label: string): void {
    jobStatus = status;
    jobStatusLabel = label;
  }

  function showError(message: string): void {
    errorMessage = message;
  }

  function hideError(): void {
    errorMessage = '';
  }

  function validateBaseUrl(showMessage: boolean): boolean {
    try {
      normalizeLocalBaseUrl(baseUrl);
      baseUrlInvalid = false;
      baseUrlError = '';
      return true;
    } catch (error) {
      baseUrlInvalid = true;
      baseUrlError = showMessage && error instanceof Error ? error.message : '';
      return false;
    }
  }

  function validatePageZoom(showMessage: boolean): boolean {
    const value = Number(pageZoomInput);
    if (
      pageZoomInput.trim() === '' ||
      !Number.isFinite(value) ||
      value < MIN_PAGE_ZOOM_PERCENT ||
      value > MAX_PAGE_ZOOM_PERCENT
    ) {
      pageZoomInvalid = true;
      pageZoomError = showMessage
        ? `Enter a zoom from ${MIN_PAGE_ZOOM_PERCENT}% to ${MAX_PAGE_ZOOM_PERCENT}%.`
        : '';
      return false;
    }
    pageZoomPercent = value;
    pageZoomInvalid = false;
    pageZoomError = '';
    return true;
  }

  function selectedShots(): Shot[] {
    return profile.shots.filter((shot) => selectedIds.includes(shot.id));
  }

  function persist(): Promise<void> {
    if (!preferences) return Promise.resolve();
    const snapshot = copyPreferences(preferences);

    preferenceWriteQueue = preferenceWriteQueue.then(async () => {
      try {
        await savePreferences(snapshot);
        settingsError = '';
      } catch {
        settingsError = 'Changes could not be saved. They will last until this controller closes.';
      }
    });
    return preferenceWriteQueue;
  }

  function recordCapture(shotId: string, savedViewportId: string): void {
    captureLog[profile.id] = {
      ...captureLog[profile.id],
      [shotId]: { savedAt: Date.now(), viewportId: savedViewportId },
    };
    const snapshot = $state.snapshot(captureLog);
    captureLogWriteQueue = captureLogWriteQueue
      .then(() => saveCaptureLog(snapshot))
      .catch(() => undefined);
  }

  function openPreview(shotId: string): void {
    previewShotId = shotId;
    previewDialog?.show();
  }

  function openDownloads(): void {
    void chrome.tabs.create({ url: 'chrome://downloads/' });
  }

  function defaultShotIds(candidate: CaptureProfile): string[] {
    return candidate.shots.filter((shot) => shot.enabledByDefault).map((shot) => shot.id);
  }

  function createShotStates(candidate: CaptureProfile): Record<string, ShotState> {
    return Object.fromEntries(
      candidate.shots.map((shot) => [shot.id, { status: 'pending' } satisfies ShotState]),
    );
  }

  function copyPreferences(source: Preferences): Preferences {
    return {
      ...source,
      baseUrls: { ...source.baseUrls },
      selectedShots: Object.fromEntries(
        Object.entries(source.selectedShots).map(([profileKey, shotIds]) => [
          profileKey,
          [...shotIds],
        ]),
      ),
    };
  }
</script>

<svelte:window onkeydown={handleKeydown} onbeforeunload={handleBeforeUnload} />

<header class="app-header">
  <div class="header-meta">
    <a class="brand" href="#workspace" aria-label="Say Cheese Localhost home">
      <div class="brand-icon">
        <IconCamera aria-hidden="true" />
      </div>
      <span class="brand-name">Say Cheese Localhost</span>
    </a>
    <div class="header-badges">
      <span class="env-badge"><span class="env-dot"></span>Localhost</span>
      <span class="header-badge">MV3 Controller</span>
    </div>
  </div>
  <button class="quiet-button btn btn-ghost" type="button" onclick={openDownloads}>
    <IconDownload aria-hidden="true" />
    <span>Open downloads</span>
  </button>
</header>

{#if !ready}
  <main id="workspace" class="controller-loading" aria-busy="true">
    <p role="status">Loading capture setup…</p>
  </main>
{:else}
  <main id="workspace" class="workspace">
    <aside class="configuration" aria-labelledby="configuration-title">
      <div class="section-heading">
        <h1 id="configuration-title">Capture setup</h1>
        <p>Choose where and how the selected routes should be framed.</p>
      </div>

      {#if settingsError}
        <div class="settings-warning" role="status">
          <strong>Settings need attention</strong>
          <p>{settingsError}</p>
        </div>
      {/if}

      <div class="config-card">
        <div class="config-card-header">
          <span class="config-card-title">Target & Environment</span>
        </div>

        <div class="field-group">
          <label for="profile">Project</label>
          <select
            class="select select-bordered w-full"
            id="profile"
            value={profileId}
            disabled={!ready || running}
            onchange={(event) => switchProfile(event.currentTarget.value)}
          >
            {#each PROFILES as candidate (candidate.id)}
              <option value={candidate.id}>{candidate.label}</option>
            {/each}
          </select>
        </div>

        <div class="field-group">
          <label for="base-url">Base URL</label>
          <input
            class="input input-bordered w-full"
            id="base-url"
            type="url"
            inputmode="url"
            spellcheck="false"
            autocomplete="off"
            value={baseUrl}
            disabled={!ready || running}
            aria-invalid={baseUrlInvalid ? 'true' : undefined}
            oninput={(event) => updateBaseUrl(event.currentTarget.value)}
            onblur={() => validateBaseUrl(true)}
          />
          <ConnectionStatus
            {pinging}
            result={pingResult}
            {ready}
            {running}
            onRetry={() => void runPing()}
          />
          <p class="field-help" id="base-url-help">
            {profile.baseUrlHint ?? 'Only localhost and loopback addresses are accepted.'}
          </p>
          <p class="field-error" id="base-url-error" aria-live="polite">{baseUrlError}</p>
        </div>

        <div class="field-group">
          <label for="viewport">Viewport</label>
          <select
            class="select select-bordered w-full"
            id="viewport"
            value={viewportId}
            disabled={!ready || running}
            onchange={(event) => updateViewport(event.currentTarget.value)}
          >
            {#each VIEWPORTS as candidate (candidate.id)}
              <option value={candidate.id}>{candidate.label}</option>
            {/each}
          </select>
          <p class="field-help" id="viewport-output">
            {#if fullPageCapture}
              {viewport.width * viewport.deviceScaleFactor}px wide at {viewport.deviceScaleFactor}×
              DPR; height follows the document.
            {:else}
              {viewport.width * viewport.deviceScaleFactor} × {viewport.height *
                viewport.deviceScaleFactor} output at {viewport.deviceScaleFactor}× DPR.
            {/if}
          </p>
          <details class="advanced-options" open={extraViewportIds.length > 0}>
            <summary>
              Also capture at{extraViewports.length > 0 ? ` (${extraViewports.length})` : ''}
            </summary>
            {#each VIEWPORTS.filter((candidate) => candidate.id !== viewportId) as candidate (candidate.id)}
              <label class="check-row compact-row">
                <input
                  class="checkbox checkbox-sm checkbox-primary"
                  type="checkbox"
                  checked={extraViewportIds.includes(candidate.id)}
                  disabled={!ready || running}
                  onchange={(event) =>
                    toggleExtraViewport(candidate.id, event.currentTarget.checked)}
                />
                <span><strong>{candidate.label}</strong></span>
              </label>
            {/each}
            <p class="field-help">
              Each viewport saves into its own folder, named by viewport, under the output folder.
            </p>
          </details>
        </div>

        <div class="field-group">
          <label for="page-zoom">Browser zoom (%)</label>
          <input
            class="input input-bordered w-full"
            id="page-zoom"
            type="number"
            inputmode="decimal"
            min={MIN_PAGE_ZOOM_PERCENT}
            max={MAX_PAGE_ZOOM_PERCENT}
            step="5"
            value={pageZoomInput}
            disabled={!ready || running}
            aria-invalid={pageZoomInvalid ? 'true' : undefined}
            aria-describedby="page-zoom-help page-zoom-error"
            oninput={(event) => updatePageZoom(event.currentTarget.value)}
            onblur={() => validatePageZoom(true)}
          />
          <p class="field-help" id="page-zoom-help">
            Uses native tab zoom, including exact values such as 220%.
          </p>
          <p class="field-error" id="page-zoom-error" aria-live="polite">{pageZoomError}</p>
        </div>

        <div class="field-group">
          <label for="image-format">Image format</label>
          <select
            class="select select-bordered w-full"
            id="image-format"
            value={imageFormat}
            disabled={!ready || running}
            aria-describedby="image-format-help"
            onchange={(event) => updateImageFormat(event.currentTarget.value)}
          >
            <option value="webp">WebP</option>
            <option value="png">PNG (lossless)</option>
          </select>
          <p class="field-help" id="image-format-help">
            {imageFormat === 'png'
              ? 'Lossless and larger. Files are saved with a .png extension.'
              : 'Quality 100, but still lossy. Choose PNG if you see artifacts.'}
          </p>
        </div>

        <div class="field-group">
          <label for="color-scheme">Color scheme</label>
          <select
            class="select select-bordered w-full"
            id="color-scheme"
            value={colorScheme}
            disabled={!ready || running}
            aria-describedby="color-scheme-help"
            onchange={(event) => updateColorScheme(event.currentTarget.value)}
          >
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <p class="field-help" id="color-scheme-help">
            Sets prefers-color-scheme. Pages render in the {profile.timezone ?? DEFAULT_TIMEZONE}
            time zone.
          </p>
        </div>
      </div>

      <fieldset class="run-options config-card">
        <legend>Capture mode</legend>
        <label class="check-row">
          <input
            class="checkbox checkbox-sm checkbox-primary"
            type="checkbox"
            checked={manual}
            disabled={!ready || running}
            onchange={(event) => updateManualPreparation(event.currentTarget.checked)}
          />
          <span
            ><strong>Prepare each shot manually</strong><small
              >Open, navigate and scroll, then capture when ready. Turn off for batch capture.</small
            ></span
          >
        </label>
        <label class="check-row">
          <input
            class="checkbox checkbox-sm checkbox-primary"
            type="checkbox"
            checked={fullPageCapture}
            disabled={!ready || running}
            onchange={(event) => updateFullPageCapture(event.currentTarget.checked)}
          />
          <span
            ><strong>Capture full page</strong><small
              >Load the complete document and save one continuous image.</small
            ></span
          >
        </label>
        <details class="advanced-options" open={captureBeyondViewport}>
          <summary>Advanced</summary>
          <label class="check-row">
            <input
              class="checkbox checkbox-sm checkbox-primary"
              type="checkbox"
              checked={fullPageCapture || captureBeyondViewport}
              disabled={!ready || running || fullPageCapture}
              onchange={(event) => updateCaptureBeyondViewport(event.currentTarget.checked)}
            />
            <span
              ><strong>Render beyond the viewport</strong><small
                >Lays the page out at its full height while capturing the current view. Try this if
                content is clipped. Fixed top and bottom bars may move. Full-page capture always
                does this.</small
              ></span
            >
          </label>
        </details>
      </fieldset>

      <fieldset class="run-options config-card">
        <legend>Failure handling</legend>
        <label class="check-row">
          <input
            class="checkbox checkbox-sm checkbox-primary"
            type="checkbox"
            checked={continueOnError}
            disabled={!ready}
            onchange={(event) => updateContinueOnError(event.currentTarget.checked)}
          />
          <span>
            <strong>Continue after errors</strong>
            <small>Finish the queue and report every failed shot.</small>
          </span>
        </label>
        <label class="check-row">
          <input
            class="checkbox checkbox-sm checkbox-primary"
            type="checkbox"
            checked={retainWindow}
            disabled={!ready}
            onchange={(event) => updateRetainWindow(event.currentTarget.checked)}
          />
          <span>
            <strong>Keep failed window open</strong>
            <small>Leave the capture window available for inspection.</small>
          </span>
        </label>
      </fieldset>

      <fieldset class="run-options config-card">
        <legend>Output</legend>
        <label class="check-row">
          <input
            class="checkbox checkbox-sm checkbox-primary"
            type="checkbox"
            checked={separateRunFolders}
            disabled={!ready || running}
            onchange={(event) => updateSeparateRunFolders(event.currentTarget.checked)}
          />
          <span>
            <strong>Save each run in its own folder</strong>
            <small
              >Adds a date and time folder so earlier runs are kept. When off, matching files are
              overwritten.</small
            >
          </span>
        </label>
      </fieldset>

      <div class="output-note config-card">
        <IconInfo aria-hidden="true" />
        <div>
          <strong>{selectedCount} {selectedCount === 1 ? 'shot' : 'shots'} selected</strong>
          <p>
            Downloads/{profile.outputDirectory}/{separateRunFolders
              ? `${lastRunFolder ?? '<date_time>'}/`
              : ''}
          </p>
        </div>
      </div>
    </aside>

    <section class="capture-panel" aria-labelledby="queue-title">
      <div class="capture-toolbar">
        <div class="capture-actions">
          <button
            class="primary-button btn btn-primary"
            type="button"
            disabled={!ready || running || selectedCount === 0}
            onclick={() => void startCapture(selectedShots())}
          >
            <IconCamera aria-hidden="true" />
            <span>
              {selectedCount === 0
                ? 'Select shots to capture'
                : `${manual ? 'Open' : 'Capture'} ${selectedCount} ${selectedCount === 1 ? 'shot' : 'shots'}`}
            </span>
          </button>
          <button
            class="stop-button btn btn-outline"
            type="button"
            disabled={!running || stopping}
            onclick={stopCapture}
          >
            <span aria-hidden="true"></span>
            Stop
          </button>
        </div>
        <p class="keyboard-hint"><kbd>Ctrl</kbd><span>+</span><kbd>Enter</kbd> to capture</p>
      </div>

      {#if manualShot}
        {@const preparedShot = manualShot}
        <ManualPreparation
          shot={preparedShot}
          saved={manualSaved}
          error={manualError}
          fullPage={fullPageCapture}
          isLastShot={manualIsLastShot}
          preview={previews[preparedShot.id]}
          shortcut={captureShortcut}
          onCapture={() => chooseManual?.('capture')}
          onNext={() => chooseManual?.('next')}
          onPreview={() => openPreview(preparedShot.id)}
        />
      {/if}
      {#if warnings.length > 0}
        <div class="settings-warning" role="status">
          <strong>Page warnings — inspect the capture window</strong>
          <ul>
            {#each warnings as warning (warning)}<li>{warning}</li>{/each}
          </ul>
        </div>
      {/if}

      <RunStatus
        completed={progressCompleted}
        total={progressTotal}
        {currentUrl}
        status={jobStatus}
        label={jobStatusLabel}
      />

      {#if errorMessage}
        <div class="error-banner alert alert-error" role="alert">
          <div>
            <strong>Capture needs attention</strong>
            <p>{errorMessage}</p>
          </div>
          {#if unfinishedShotIds.length > 0}
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              disabled={running}
              onclick={retryUnfinished}
              >Retry {unfinishedShotIds.length} unfinished {unfinishedShotIds.length === 1
                ? 'shot'
                : 'shots'}</button
            >
          {/if}
        </div>
      {/if}

      <ShotQueue
        {profile}
        {shotStates}
        {selectedIds}
        {previews}
        {captureLog}
        {ready}
        {running}
        onToggleShot={toggleShot}
        onToggleAll={toggleAll}
        onRetry={(shot) => void startCapture([shot])}
        onPreview={openPreview}
      />

      <footer class="capture-footer">
        <p>{footerSummary}</p>
      </footer>
      <PreviewDialog
        bind:this={previewDialog}
        shot={previewShot}
        image={previewShot ? previews[previewShot.id] : undefined}
        onClosed={() => (previewShotId = undefined)}
      />
    </section>
  </main>
{/if}
