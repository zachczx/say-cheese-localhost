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
  navigating: 'Navigating',
  preparing: 'Preparing',
  capturing: 'Capturing',
  downloading: 'Downloading',
  complete: 'Complete',
  failed: 'Failed',
};

const elements = {
  profile: required<HTMLSelectElement>('profile'),
  baseUrl: required<HTMLInputElement>('base-url'),
  baseUrlError: required<HTMLElement>('base-url-error'),
  viewport: required<HTMLSelectElement>('viewport'),
  viewportOutput: required<HTMLElement>('viewport-output'),
  continueOnError: required<HTMLInputElement>('continue-on-error'),
  retainWindow: required<HTMLInputElement>('retain-window'),
  outputCount: required<HTMLElement>('output-count'),
  outputPath: required<HTMLElement>('output-path'),
  capture: required<HTMLButtonElement>('capture'),
  captureLabel: required<HTMLElement>('capture-label'),
  stop: required<HTMLButtonElement>('stop'),
  progress: required<HTMLProgressElement>('progress'),
  progressLabel: required<HTMLElement>('progress-label'),
  currentUrl: required<HTMLElement>('current-url'),
  jobStatus: required<HTMLElement>('job-status'),
  errorBanner: required<HTMLElement>('error-banner'),
  errorMessage: required<HTMLElement>('error-message'),
  retryRun: required<HTMLButtonElement>('retry-run'),
  queueSummary: required<HTMLElement>('queue-summary'),
  shotList: required<HTMLElement>('shot-list'),
  selectAll: required<HTMLButtonElement>('select-all'),
  selectNone: required<HTMLButtonElement>('select-none'),
  footerSummary: required<HTMLElement>('footer-summary'),
  openDownloads: required<HTMLButtonElement>('open-downloads'),
  footerDownloads: required<HTMLButtonElement>('footer-downloads'),
};

let profile = PROFILES[0] as CaptureProfile;
let selected = new Set<string>();
let shotStates = new Map<string, ShotState>();
let abortController: AbortController | undefined;
let running = false;
let lastRunShotIds: string[] = [];
let preferences: Preferences;

await initialize();

async function initialize(): Promise<void> {
  const stored = await loadPreferences();
  profile =
    PROFILES.find((candidate) => candidate.id === stored.profileId) ??
    (PROFILES[0] as CaptureProfile);
  preferences = {
    profileId: profile.id,
    viewportId: stored.viewportId ?? profile.defaultViewport,
    baseUrls: stored.baseUrls ?? {},
    selectedShots: stored.selectedShots ?? {},
    continueOnError: stored.continueOnError ?? true,
    retainWindowAfterFailure: stored.retainWindowAfterFailure ?? false,
  };

  for (const candidate of PROFILES) {
    elements.profile.add(new Option(candidate.label, candidate.id));
  }
  for (const viewport of VIEWPORTS) {
    elements.viewport.add(new Option(viewport.label, viewport.id));
  }
  elements.profile.value = profile.id;
  elements.viewport.value = VIEWPORTS.some((viewport) => viewport.id === preferences.viewportId)
    ? preferences.viewportId
    : profile.defaultViewport;
  elements.baseUrl.value = preferences.baseUrls[profile.id] ?? profile.defaultBaseUrl;
  elements.continueOnError.checked = preferences.continueOnError;
  elements.retainWindow.checked = preferences.retainWindowAfterFailure;
  selected = new Set(
    preferences.selectedShots[profile.id] ??
      profile.shots.filter((shot) => shot.enabledByDefault).map((shot) => shot.id),
  );
  resetShotStates();
  bindEvents();
  render();
}

function bindEvents(): void {
  elements.profile.addEventListener('change', () => {
    const next = PROFILES.find((candidate) => candidate.id === elements.profile.value);
    if (!next || running) return;
    profile = next;
    preferences.profileId = profile.id;
    elements.baseUrl.value = preferences.baseUrls[profile.id] ?? profile.defaultBaseUrl;
    elements.viewport.value = profile.defaultViewport;
    preferences.viewportId = profile.defaultViewport;
    selected = new Set(
      preferences.selectedShots[profile.id] ??
        profile.shots.filter((shot) => shot.enabledByDefault).map((shot) => shot.id),
    );
    resetShotStates();
    hideError();
    void persist();
    render();
  });

  elements.baseUrl.addEventListener('input', () => {
    validateBaseUrl(false);
    preferences.baseUrls[profile.id] = elements.baseUrl.value;
    void persist();
  });
  elements.baseUrl.addEventListener('blur', () => validateBaseUrl(true));
  elements.viewport.addEventListener('change', () => {
    preferences.viewportId = elements.viewport.value;
    void persist();
    renderViewport();
  });
  elements.continueOnError.addEventListener('change', () => {
    preferences.continueOnError = elements.continueOnError.checked;
    void persist();
  });
  elements.retainWindow.addEventListener('change', () => {
    preferences.retainWindowAfterFailure = elements.retainWindow.checked;
    void persist();
  });
  elements.selectAll.addEventListener('click', () =>
    setSelection(profile.shots.map((shot) => shot.id)),
  );
  elements.selectNone.addEventListener('click', () => setSelection([]));
  elements.capture.addEventListener('click', () => void startCapture(selectedShots()));
  elements.stop.addEventListener('click', stopCapture);
  elements.retryRun.addEventListener('click', () => {
    const retryShots = profile.shots.filter((shot) => lastRunShotIds.includes(shot.id));
    void startCapture(retryShots);
  });
  elements.openDownloads.addEventListener('click', openDownloads);
  elements.footerDownloads.addEventListener('click', openDownloads);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !running) {
      event.preventDefault();
      void startCapture(selectedShots());
    }
  });
}

function render(): void {
  renderViewport();
  renderShots();
  renderSelection();
  elements.profile.disabled = running;
  elements.baseUrl.disabled = running;
  elements.viewport.disabled = running;
  elements.selectAll.disabled = running;
  elements.selectNone.disabled = running;
  elements.capture.disabled = running || selected.size === 0;
  elements.stop.disabled = !running;
}

function renderViewport(): void {
  const viewport = selectedViewport();
  elements.viewportOutput.textContent = `${viewport.width * viewport.deviceScaleFactor} × ${viewport.height * viewport.deviceScaleFactor} output at ${viewport.deviceScaleFactor}× DPR.`;
}

function renderShots(): void {
  elements.shotList.replaceChildren();
  profile.shots.forEach((shot, index) => {
    const state = shotStates.get(shot.id) ?? { status: 'pending' };
    const row = document.createElement('tr');
    row.dataset.status = state.status;
    row.dataset.active = String(
      ['navigating', 'preparing', 'capturing', 'downloading'].includes(state.status),
    );

    const selectCell = document.createElement('td');
    selectCell.className = 'select-column';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(shot.id);
    checkbox.disabled = running;
    checkbox.setAttribute('aria-label', `Select ${shot.label}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(shot.id);
      else selected.delete(shot.id);
      preferences.selectedShots[profile.id] = [...selected];
      void persist();
      renderSelection();
    });
    selectCell.append(checkbox);

    const orderCell = document.createElement('td');
    orderCell.className = 'order-column';
    orderCell.textContent = String(index + 1).padStart(2, '0');

    const titleCell = document.createElement('td');
    const title = document.createElement('span');
    title.className = 'shot-title';
    title.textContent = shot.label;
    const filename = document.createElement('span');
    filename.className = 'shot-file';
    filename.textContent = shot.filename;
    titleCell.append(title, filename);

    const routeCell = document.createElement('td');
    const route = document.createElement('code');
    route.className = 'route-code';
    route.textContent = shot.path;
    route.title = shot.path;
    routeCell.append(route);

    const statusCell = document.createElement('td');
    statusCell.className = 'status-column';
    const status = document.createElement('span');
    status.className = 'status-badge';
    status.dataset.status = state.status;
    status.textContent = statusLabels[state.status];
    if (state.error) status.title = state.error;
    statusCell.append(status);

    const actionCell = document.createElement('td');
    actionCell.className = 'retry-column';
    if (state.status === 'failed') {
      const retry = document.createElement('button');
      retry.className = 'retry-shot';
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.disabled = running;
      retry.addEventListener('click', () => void startCapture([shot]));
      actionCell.append(retry);
    }

    row.append(selectCell, orderCell, titleCell, routeCell, statusCell, actionCell);
    elements.shotList.append(row);
  });
}

function renderSelection(): void {
  const count = selected.size;
  elements.outputCount.textContent = `${count} ${count === 1 ? 'shot' : 'shots'} selected`;
  elements.outputPath.textContent = `Downloads/${profile.outputDirectory}/`;
  elements.captureLabel.textContent =
    count === 0 ? 'Select shots to capture' : `Capture ${count} ${count === 1 ? 'shot' : 'shots'}`;
  elements.capture.disabled = running || count === 0;
  elements.queueSummary.textContent = `${profile.shots.length} ordered shots · ${count} selected`;
}

async function startCapture(shots: Shot[]): Promise<void> {
  if (running || shots.length === 0 || !validateBaseUrl(true)) return;
  const viewport = selectedViewport();
  lastRunShotIds = shots.map((shot) => shot.id);
  for (const shot of shots) shotStates.set(shot.id, { status: 'pending' });
  abortController = new AbortController();
  running = true;
  hideError();
  setProgress(0, shots.length);
  setJobStatus('preparing', 'Opening capture window');
  elements.currentUrl.textContent = 'Preparing localhost target…';
  render();

  try {
    const result = await runCaptureJob({
      profile,
      baseUrl: elements.baseUrl.value,
      viewport,
      shots,
      continueOnError: elements.continueOnError.checked,
      retainWindowAfterFailure: elements.retainWindow.checked,
      signal: abortController.signal,
      onShotUpdate(update) {
        shotStates.set(update.shotId, { status: update.status, error: update.detail });
        elements.currentUrl.textContent = update.currentUrl;
        setJobStatus(update.status, statusLabels[update.status]);
        renderShots();
      },
      onProgress: setProgress,
    });

    if (result.stopped) {
      setJobStatus('failed', 'Stopped');
      elements.footerSummary.textContent = `Stopped after ${result.completed} completed ${result.completed === 1 ? 'shot' : 'shots'}.`;
    } else if (result.failures.length > 0) {
      setJobStatus('failed', `${result.failures.length} failed`);
      showError(
        result.failures.map((failure) => `${failure.shotId}: ${failure.message}`).join(' '),
      );
      elements.footerSummary.textContent = result.windowRetained
        ? 'The capture window was left open for inspection.'
        : 'Completed shots were downloaded; failed shots can be retried.';
    } else {
      setJobStatus('complete', 'Complete');
      elements.currentUrl.textContent = 'All selected shots finished';
      elements.footerSummary.textContent = `${result.completed} ${result.completed === 1 ? 'image' : 'images'} saved to Downloads/${profile.outputDirectory}/`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setJobStatus('failed', 'Capture failed');
    showError(message);
    elements.footerSummary.textContent =
      'Nothing unsafe was captured. Correct the problem and retry.';
  } finally {
    running = false;
    abortController = undefined;
    render();
  }
}

function stopCapture(): void {
  abortController?.abort(new DOMException('Capture stopped.', 'AbortError'));
  elements.stop.disabled = true;
  setJobStatus('preparing', 'Stopping safely');
}

function setSelection(ids: string[]): void {
  if (running) return;
  selected = new Set(ids);
  preferences.selectedShots[profile.id] = [...selected];
  void persist();
  renderShots();
  renderSelection();
}

function resetShotStates(): void {
  shotStates = new Map(profile.shots.map((shot) => [shot.id, { status: 'pending' }]));
  setProgress(0, profile.shots.length);
  setJobStatus('pending', 'Idle');
  elements.currentUrl.textContent = 'Ready to capture';
}

function setProgress(completed: number, total: number): void {
  elements.progress.max = Math.max(total, 1);
  elements.progress.value = completed;
  elements.progressLabel.textContent = `${completed} / ${total}`;
}

function setJobStatus(status: ShotStatus, label: string): void {
  elements.jobStatus.dataset.status = status;
  elements.jobStatus.textContent = label;
}

function showError(message: string): void {
  elements.errorMessage.textContent = message;
  elements.errorBanner.hidden = false;
}

function hideError(): void {
  elements.errorBanner.hidden = true;
  elements.errorMessage.textContent = '';
}

function validateBaseUrl(showMessage: boolean): boolean {
  try {
    normalizeLocalBaseUrl(elements.baseUrl.value);
    elements.baseUrl.removeAttribute('aria-invalid');
    elements.baseUrlError.textContent = '';
    return true;
  } catch (error) {
    elements.baseUrl.setAttribute('aria-invalid', 'true');
    elements.baseUrlError.textContent = showMessage && error instanceof Error ? error.message : '';
    return false;
  }
}

function selectedShots(): Shot[] {
  return profile.shots.filter((shot) => selected.has(shot.id));
}

function selectedViewport() {
  return VIEWPORTS.find((viewport) => viewport.id === elements.viewport.value) ?? VIEWPORTS[0];
}

async function persist(): Promise<void> {
  await savePreferences(preferences);
}

function openDownloads(): void {
  void chrome.tabs.create({ url: 'chrome://downloads/' });
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing controller element #${id}.`);
  return element as T;
}
