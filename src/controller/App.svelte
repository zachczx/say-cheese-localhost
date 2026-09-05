<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  import { normalizeLocalBaseUrl, runCaptureJob, type ShotStatus } from '../capture/job';
  import { PROFILES } from '../profiles';
  import type { CaptureProfile, Shot } from '../profiles/schema';
  import { VIEWPORTS } from '../profiles/viewports';
  import { loadPreferences, savePreferences, type Preferences } from '../storage/preferences';

  interface ShotState {
    status: ShotStatus;
    error?: string;
  }

  const statusLabels: Record<ShotStatus, string> = {
    pending: 'Pending',
    waiting: 'Prepare manually',
    skipped: 'Skipped',
    navigating: 'Navigating',
    preparing: 'Preparing',
    capturing: 'Capturing',
    downloading: 'Downloading',
    complete: 'Complete',
    failed: 'Failed',
  };

  const activeStatuses: ShotStatus[] = ['navigating', 'preparing', 'capturing', 'downloading'];
  const initialProfile = PROFILES[0] as CaptureProfile;

  let profile = $state<CaptureProfile>(initialProfile);
  let profileId = $state(initialProfile.id);
  let baseUrl = $state(initialProfile.defaultBaseUrl);
  let baseUrlInvalid = $state(false);
  let baseUrlError = $state('');
  let viewportId = $state(initialProfile.defaultViewport);
  let continueOnError = $state(true);
  let retainWindow = $state(false);
  let selectedIds = $state(defaultShotIds(initialProfile));
  let shotStates = $state<Record<string, ShotState>>(createShotStates(initialProfile));
  let preferences: Preferences | undefined;
  let abortController: AbortController | undefined;
  let manual = $state(true);
  let manualShot = $state<Shot>();
  let manualSaved = $state(false);
  let manualError = $state('');
  let warnings = $state<string[]>([]);
  let chooseManual: ((action: 'capture' | 'next') => void) | undefined;
  let ready = $state(false);
  let running = $state(false);
  let stopping = $state(false);
  let lastRunShotIds = $state<string[]>([]);
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
  const allSelected = $derived(profile.shots.length > 0 && selectedCount === profile.shots.length);
  const partiallySelected = $derived(selectedCount > 0 && !allSelected);
  const viewport = $derived(
    VIEWPORTS.find((candidate) => candidate.id === viewportId) ?? VIEWPORTS[0],
  );

  onMount(() => {
    void initialize();
  });

  onDestroy(() => abortController?.abort());

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
    } finally {
      ready = true;
    }
  }

  function applyPreferences(stored: Partial<Preferences>): void {
    const storedProfile =
      PROFILES.find((candidate) => candidate.id === stored.profileId) ?? initialProfile;

    profile = storedProfile;
    profileId = storedProfile.id;
    const loadedPreferences: Preferences = {
      profileId: storedProfile.id,
      viewportId: stored.viewportId ?? storedProfile.defaultViewport,
      baseUrls: stored.baseUrls ?? {},
      selectedShots: stored.selectedShots ?? {},
      continueOnError: stored.continueOnError ?? true,
      retainWindowAfterFailure: stored.retainWindowAfterFailure ?? false,
    };
    preferences = loadedPreferences;

    viewportId = VIEWPORTS.some((candidate) => candidate.id === loadedPreferences.viewportId)
      ? loadedPreferences.viewportId
      : storedProfile.defaultViewport;
    baseUrl = loadedPreferences.baseUrls[storedProfile.id] ?? storedProfile.defaultBaseUrl;
    continueOnError = loadedPreferences.continueOnError;
    retainWindow = loadedPreferences.retainWindowAfterFailure;
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
    baseUrl = preferences.baseUrls[next.id] ?? next.defaultBaseUrl;
    baseUrlInvalid = false;
    baseUrlError = '';
    viewportId = next.defaultViewport;
    preferences.viewportId = next.defaultViewport;
    selectedIds = preferences.selectedShots[next.id] ?? defaultShotIds(next);
    resetShotStates();
    hideError();
    void persist();
  }

  function updateBaseUrl(value: string): void {
    baseUrl = value;
    validateBaseUrl(false);
    if (!preferences) return;
    preferences.baseUrls[profile.id] = value;
    void persist();
  }

  function updateViewport(nextViewportId: string): void {
    viewportId = nextViewportId;
    if (!preferences) return;
    preferences.viewportId = nextViewportId;
    void persist();
  }

  function updateContinueOnError(value: boolean): void {
    continueOnError = value;
    if (!preferences) return;
    preferences.continueOnError = value;
    void persist();
  }

  function updateRetainWindow(value: boolean): void {
    retainWindow = value;
    if (!preferences) return;
    preferences.retainWindowAfterFailure = value;
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

  async function startCapture(shots: Shot[]): Promise<void> {
    if (running || shots.length === 0 || !validateBaseUrl(true)) return;
    lastRunShotIds = shots.map((shot) => shot.id);
    for (const shot of shots) {
      shotStates[shot.id] = { status: 'pending' };
    }
    abortController = new AbortController();
    running = true;
    stopping = false;
    hideError();
    manualSaved = false;
    manualError = '';
    warnings = [];
    setProgress(0, shots.length);
    setJobStatus('preparing', 'Opening capture window');
    currentUrl = 'Preparing localhost target…';

    try {
      const result = await runCaptureJob({
        profile,
        baseUrl,
        viewport,
        shots,
        continueOnError,
        retainWindowAfterFailure: retainWindow,
        signal: abortController.signal,
        onManualReady: manual ? awaitManualCapture : undefined,
        onWarnings: (value) => {
          warnings = value;
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
          setJobStatus(update.status, statusLabels[update.status]);
        },
        onProgress: setProgress,
      });

      if (result.stopped) {
        setJobStatus('failed', 'Stopped');
        footerSummary = `Stopped after ${result.completed} completed ${result.completed === 1 ? 'shot' : 'shots'}.`;
      } else if (result.failures.length > 0) {
        setJobStatus('failed', `${result.failures.length} failed`);
        showError(
          result.failures.map((failure) => `${failure.shotId}: ${failure.message}`).join(' '),
        );
        footerSummary = result.windowRetained
          ? 'The capture window was left open for inspection.'
          : 'Completed shots were downloaded; failed shots can be retried.';
      } else {
        setJobStatus('complete', 'Complete');
        currentUrl = result.skipped
          ? `${result.skipped} shots skipped`
          : 'All selected shots finished';
        footerSummary = `${result.completed} ${result.completed === 1 ? 'image' : 'images'} saved to Downloads/${profile.outputDirectory}/`;
      }
    } catch (error) {
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
    }
  }

  function retryLastRun(): void {
    const retryShots = profile.shots.filter((shot) => lastRunShotIds.includes(shot.id));
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

<svelte:window onkeydown={handleKeydown} />

<header class="app-header">
  <a class="brand" href="#workspace" aria-label="Say Cheese Localhost home">
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M4 7.5h3l1.2-2h7.6l1.2 2h3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"
      />
      <circle cx="12" cy="13.5" r="4" />
    </svg>
    <span>Say Cheese Localhost</span>
  </a>
  <button class="quiet-button" type="button" onclick={openDownloads}>
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v3h16v-3" />
    </svg>
    Open downloads
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

      <div class="field-group">
        <label for="profile">Project</label>
        <select
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
        <p class="field-help" id="base-url-help">
          {profile.id === 'cubby'
            ? 'Cubby QA: use 127.0.0.1:5174 with a verified household seed.'
            : 'Only localhost and loopback addresses are accepted.'}
        </p>
        <p class="field-error" id="base-url-error" aria-live="polite">{baseUrlError}</p>
      </div>

      <div class="field-group">
        <label for="viewport">Viewport</label>
        <select
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
          {viewport.width * viewport.deviceScaleFactor} × {viewport.height *
            viewport.deviceScaleFactor} output at {viewport.deviceScaleFactor}× DPR.
        </p>
      </div>

      <fieldset class="run-options">
        <legend>Capture mode</legend>
        <label class="check-row">
          <input type="checkbox" bind:checked={manual} disabled={running} />
          <span
            ><strong>Prepare each shot manually</strong><small
              >Open, navigate and scroll, then capture when ready. Turn off for batch capture.</small
            ></span
          >
        </label>
      </fieldset>

      <fieldset class="run-options">
        <legend>Failure handling</legend>
        <label class="check-row">
          <input
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

      <div class="output-note">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6m0-9.25v.5" />
        </svg>
        <div>
          <strong>{selectedCount} {selectedCount === 1 ? 'shot' : 'shots'} selected</strong>
          <p>Downloads/{profile.outputDirectory}/</p>
        </div>
      </div>
    </aside>

    <section class="capture-panel" aria-labelledby="queue-title">
      <div class="capture-toolbar">
        <div class="capture-actions">
          <button
            class="primary-button"
            type="button"
            disabled={!ready || running || selectedCount === 0}
            onclick={() => void startCapture(selectedShots())}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path
                d="M4 7.5h3l1.2-2h7.6l1.2 2h3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"
              />
              <circle cx="12" cy="13.5" r="4" />
            </svg>
            <span>
              {selectedCount === 0
                ? 'Select shots to capture'
                : `${manual ? 'Open' : 'Capture'} ${selectedCount} ${selectedCount === 1 ? 'shot' : 'shots'}`}
            </span>
          </button>
          <button
            class="stop-button"
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
        <div class="manual-preparation" aria-live="polite">
          <strong>{manualShot.label}</strong>
          <p>
            {manualShot.preparation ?? 'Arrange the capture window, then capture the current view.'}
          </p>
          <p>
            {manualError && manualSaved
              ? 'An earlier image was saved, but the latest attempt failed.'
              : manualSaved
                ? 'Image saved. You can retake it or move on.'
                : 'Navigate and scroll freely. Capture keeps your current framing.'}
          </p>
          {#if manualError}<p role="alert">{manualError} Correct the page and retry here.</p>{/if}
          <div class="capture-actions">
            <button class="primary-button" type="button" onclick={() => chooseManual?.('capture')}
              >Capture current view</button
            >
            <button class="quiet-button" type="button" onclick={() => chooseManual?.('next')}
              >{manualSaved ? 'Next shot / finish' : 'Skip shot'}</button
            >
          </div>
        </div>
      {/if}
      {#if warnings.length > 0}
        <div class="settings-warning" role="status">
          <strong>Page warnings — inspect the capture window</strong>
          <ul>
            {#each warnings as warning (warning)}<li>{warning}</li>{/each}
          </ul>
        </div>
      {/if}

      <div class="run-status" aria-live="polite">
        <div class="progress-block">
          <div class="status-label-row">
            <span>Overall progress</span>
            <strong>{progressCompleted} / {progressTotal}</strong>
          </div>
          <progress value={progressCompleted} max={Math.max(progressTotal, 1)}></progress>
        </div>
        <div class="current-location">
          <span>Current URL</span>
          <strong>{currentUrl}</strong>
        </div>
        <div class="current-state">
          <span>Status</span>
          <strong data-status={jobStatus}>{jobStatusLabel}</strong>
        </div>
      </div>

      {#if errorMessage}
        <div class="error-banner" role="alert">
          <div>
            <strong>Capture needs attention</strong>
            <p>{errorMessage}</p>
          </div>
          <button type="button" disabled={running} onclick={retryLastRun}>Retry</button>
        </div>
      {/if}

      <div class="queue-header">
        <div>
          <h2 id="queue-title">Shot queue</h2>
          <p>{profile.shots.length} ordered shots · {selectedCount} selected</p>
        </div>
      </div>

      <div class="shot-table-wrap">
        <table class="shot-table">
          <thead>
            <tr>
              <th class="order-column">Order</th>
              <th>Shot</th>
              <th>Route</th>
              <th class="status-column">Status</th>
              <th class="retry-column"><span class="sr-only">Actions</span></th>
              <th class="select-column">
                <input
                  type="checkbox"
                  checked={allSelected}
                  indeterminate={partiallySelected}
                  disabled={!ready || running || profile.shots.length === 0}
                  aria-label={allSelected ? 'Clear all shot selections' : 'Select all shots'}
                  title={allSelected ? 'Clear all selections' : 'Select all shots'}
                  onchange={(event) => toggleAll(event.currentTarget.checked)}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {#each profile.shots as shot, index (shot.id)}
              {@const state = shotStates[shot.id] ?? { status: 'pending' }}
              <tr data-status={state.status} data-active={activeStatuses.includes(state.status)}>
                <td class="order-column">{String(index + 1).padStart(2, '0')}</td>
                <td>
                  <span class="shot-title">{shot.label}</span>
                  <span class="shot-file">{shot.filename}</span>
                  {#if shot.preparation}<span class="shot-file">{shot.preparation}</span>{/if}
                </td>
                <td><code class="route-code" title={shot.path}>{shot.path}</code></td>
                <td class="status-column">
                  <span class="status-badge" data-status={state.status} title={state.error}>
                    {statusLabels[state.status]}
                  </span>
                </td>
                <td class="retry-column">
                  {#if state.status === 'failed'}
                    <button
                      class="retry-shot"
                      type="button"
                      disabled={running}
                      onclick={() => void startCapture([shot])}
                    >
                      Retry
                    </button>
                  {/if}
                </td>
                <td class="select-column">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(shot.id)}
                    disabled={running}
                    aria-label={`Select ${shot.label}`}
                    onchange={(event) => toggleShot(shot.id, event.currentTarget.checked)}
                  />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <footer class="capture-footer">
        <p>{footerSummary}</p>
        <button class="text-button" type="button" onclick={openDownloads}>Open downloads</button>
      </footer>
    </section>
  </main>
{/if}
