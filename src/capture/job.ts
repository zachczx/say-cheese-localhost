import type { CaptureProfile, Shot, ViewportPreset } from '../profiles/schema';
import { joinDownloadPath, resolveTimeouts } from '../profiles/schema';
import { delay, runWithTimeout, throwIfAborted } from './async';
import { runActions, createCdpActionDriver } from './actions';
import { DebuggerSession, type DebuggerDetachReason } from './debugger';
import { PageDiagnostics } from './diagnostics';
import { applyEmulation, clearEmulation, type ColorScheme } from './emulation';
import { navigateAndWait } from './navigation';
import { forgetCaptureWindow, rememberCaptureWindow } from './orphans';
import { besideController } from './placement';
import {
  evaluate,
  NetworkQuietTracker,
  prepareDocument,
  restoreDocumentScroll,
  type ScrollPosition,
  waitForDocumentAssets,
  waitForPaint,
  waitForReadyConditions,
} from './readiness';
import { RequestReplacementInterceptor } from './requests';
import {
  captureShot,
  downloadScreenshot,
  outputFilename,
  waitForDownload,
  type ImageFormat,
} from './screenshot';
import { normalizeLocalBaseUrl } from './url';
import { applyPageZoom } from './zoom';

export { describePageException } from './diagnostics';

export type ShotStatus =
  | 'pending'
  | 'waiting'
  | 'skipped'
  | 'navigating'
  | 'preparing'
  | 'capturing'
  | 'downloading'
  | 'complete'
  | 'failed';

export interface ShotUpdate {
  shotId: string;
  status: ShotStatus;
  currentUrl: string;
  detail?: string;
}

export interface CaptureFailure {
  shotId: string;
  currentUrl: string;
  message: string;
}

export interface CaptureJobOptions {
  profile: CaptureProfile;
  baseUrl: string;
  viewport: ViewportPreset;
  shots: Shot[];
  continueOnError: boolean;
  retainWindowAfterFailure: boolean;
  captureBeyondViewport?: boolean;
  fullPage?: boolean;
  pageZoomPercent?: number;
  /** Optional folder beneath the profile's output directory, such as a run timestamp. */
  outputSubdirectory?: string;
  /** Output format. Defaults to WebP; PNG swaps each file's extension. */
  format?: ImageFormat;
  /** Overrides `prefers-color-scheme` for the capture window. */
  colorScheme?: ColorScheme;
  signal?: AbortSignal;
  onShotUpdate?: (update: ShotUpdate) => void;
  onManualReady?: (shot: Shot, signal: AbortSignal) => Promise<'capture' | 'next'>;
  onWarnings?: (warnings: string[]) => void;
  /** Receives each image after Chrome finishes writing it to Downloads. */
  onShotSaved?: (shotId: string, dataUrl: string) => void;
  onProgress?: (completed: number, total: number) => void;
}

export interface CaptureJobResult {
  completed: number;
  skipped?: number;
  failures: CaptureFailure[];
  stopped: boolean;
  windowRetained: boolean;
}

type ResolvedTimeouts = ReturnType<typeof resolveTimeouts>;

/** Everything a shot needs once the capture window is attached and prepared. */
interface JobContext {
  options: CaptureJobOptions;
  baseUrl: string;
  timeouts: ResolvedTimeouts;
  outputDirectory: string;
  windowId: number | undefined;
  tabId: number;
  session: DebuggerSession;
  tracker: NetworkQuietTracker;
  interceptor: RequestReplacementInterceptor;
  diagnostics: PageDiagnostics;
  /** Aborts on Stop, on an external signal, or when Chrome detaches the debugger. */
  signal: AbortSignal;
  tally: Tally;
}

interface Tally {
  completed: number;
  skipped: number;
  failures: CaptureFailure[];
}

/** The shot's URL as last observed; manual preparation may navigate elsewhere. */
interface ShotLocation {
  url: string;
}

/** Resources to release in teardown, filled in as setup progresses. */
interface JobResources {
  windowId?: number;
  session?: DebuggerSession;
  tracker?: NetworkQuietTracker;
  interceptor?: RequestReplacementInterceptor;
}

export async function runCaptureJob(options: CaptureJobOptions): Promise<CaptureJobResult> {
  const baseUrl = normalizeLocalBaseUrl(options.baseUrl);
  const timeouts = resolveTimeouts(options.profile.timeouts);
  const outputDirectory = options.outputSubdirectory
    ? joinDownloadPath(options.profile.outputDirectory, options.outputSubdirectory)
    : options.profile.outputDirectory;
  const jobController = new AbortController();
  const onExternalAbort = () => jobController.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  const tally: Tally = { completed: 0, skipped: 0, failures: [] };
  const resources: JobResources = {};
  let detached = false;
  let stopped = false;
  let unexpectedError: unknown;
  let windowRetained: boolean;

  try {
    const { windowId, tabId } = await openCaptureWindow(
      options.viewport,
      jobController.signal,
      resources,
    );
    const session = await attachSession(tabId, jobController.signal, (reason) => {
      detached = true;
      jobController.abort(new Error(`Chrome detached the capture debugger (${reason}).`));
    });
    resources.session = session;
    const diagnostics = new PageDiagnostics(options.onWarnings);
    session.onEvent((event) => diagnostics.handle(event));
    await prepareSession(session, options);

    const tracker = new NetworkQuietTracker();
    tracker.start(session);
    resources.tracker = tracker;
    const interceptor = new RequestReplacementInterceptor(
      session,
      options.profile.requestReplacements ?? [],
    );
    resources.interceptor = interceptor;
    await interceptor.start();

    const context: JobContext = {
      options,
      baseUrl,
      timeouts,
      outputDirectory,
      windowId,
      tabId,
      session,
      tracker,
      interceptor,
      diagnostics,
      signal: jobController.signal,
      tally,
    };

    if (options.profile.preflight) await runPreflight(context, options.profile.preflight);

    options.onProgress?.(0, options.shots.length);
    for (const shot of options.shots) {
      throwIfAborted(jobController.signal);
      const keepGoing = await processShot(context, shot);
      if (!keepGoing) break;
    }
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) stopped = true;
    else if (jobController.signal.aborted && !detached) stopped = true;
    else unexpectedError = error;
  } finally {
    options.signal?.removeEventListener('abort', onExternalAbort);
    windowRetained =
      (tally.failures.length > 0 || unexpectedError !== undefined) &&
      options.retainWindowAfterFailure &&
      !stopped;
    await releaseResources(resources, windowRetained);
  }

  if (unexpectedError !== undefined) throw unexpectedError;

  return {
    completed: tally.completed,
    skipped: tally.skipped,
    failures: tally.failures,
    stopped,
    windowRetained,
  };
}

// ---------------------------------------------------------------------------
// Setup and teardown

/** Records the window in `resources` as soon as it exists, so a later setup failure still closes it. */
async function openCaptureWindow(
  viewport: ViewportPreset,
  signal: AbortSignal,
  resources: JobResources,
): Promise<{ windowId: number | undefined; tabId: number }> {
  const controllerWindow = await chrome.windows.getCurrent?.().catch(() => undefined);
  const captureWindow = await chrome.windows.create({
    url: 'about:blank',
    type: 'normal',
    focused: true,
    ...besideController(
      controllerWindow,
      {
        width: Math.max(640, viewport.width + 80),
        height: Math.max(640, viewport.height + 120),
      },
      workArea(),
    ),
  });
  if (!captureWindow) throw new Error('Chrome did not create a capture window.');
  const windowId = captureWindow.id;
  resources.windowId = windowId;
  const tabId = captureWindow.tabs?.[0]?.id;
  if (tabId === undefined) throw new Error('Chrome did not create a capture tab.');
  if (windowId !== undefined) {
    // Lets the background worker clean up if the controller closes mid-run.
    const ownerTabId = (await chrome.tabs.getCurrent?.().catch(() => undefined))?.id;
    await rememberCaptureWindow({ windowId, tabId, ownerTabId }).catch(() => undefined);
  }
  await retryWhileTabInitializes(() => applyPageZoom(tabId), signal);
  return { windowId, tabId };
}

async function attachSession(
  tabId: number,
  signal: AbortSignal,
  onDetach: (reason: DebuggerDetachReason) => void,
): Promise<DebuggerSession> {
  const session = new DebuggerSession(tabId);
  await retryWhileTabInitializes(() => session.attach(), signal);
  session.onDetach(onDetach);
  return session;
}

async function prepareSession(session: DebuggerSession, options: CaptureJobOptions): Promise<void> {
  await Promise.all([
    session.send('Page.enable'),
    session.send('Runtime.enable'),
    session.send('Network.enable'),
  ]);
  await session.send('Network.setBypassServiceWorker', { bypass: true });
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await applyEmulation(session, options.viewport, {
    timezoneId: options.profile.timezone,
    colorScheme: options.colorScheme,
  });
}

/** Detaches the debugger and undoes emulation before closing or retaining the window. */
async function releaseResources(resources: JobResources, retainWindow: boolean): Promise<void> {
  resources.tracker?.stop();
  await resources.interceptor?.stop().catch(() => undefined);
  const { session, windowId } = resources;
  if (session?.attached) {
    await session.send('Network.setBypassServiceWorker', { bypass: false }).catch(() => undefined);
    await clearEmulation(session);
    await session.detach().catch(() => undefined);
  }
  if (windowId === undefined) return;
  if (!retainWindow) await chrome.windows.remove(windowId).catch(() => undefined);
  await forgetCaptureWindow(windowId).catch(() => undefined);
}

function workArea(): { left: number; top: number; width: number; height: number } {
  const area = globalThis.screen as
    (Screen & { availLeft?: number; availTop?: number }) | undefined;
  return {
    left: area?.availLeft ?? 0,
    top: area?.availTop ?? 0,
    width: area?.availWidth || 1920,
    height: area?.availHeight || 1080,
  };
}

// ---------------------------------------------------------------------------
// Shots

/** Opens, prepares, and captures one shot. Returns false when the run should stop. */
async function processShot(context: JobContext, shot: Shot): Promise<boolean> {
  const { options, tally } = context;
  const location: ShotLocation = { url: new URL(shot.path, context.baseUrl).href };
  context.diagnostics.reset();
  try {
    await runWithTimeout(
      (signal) => openShot(context, shot, location, signal),
      context.timeouts.shotMs,
      `Could not open "${shot.id}"`,
      context.signal,
    );
    if (options.onManualReady) {
      await captureWithPreparation(context, shot, location, options.onManualReady);
    } else {
      await runWithTimeout(
        (signal) => captureAttempt(context, shot, location, signal, false),
        context.timeouts.shotMs,
        `Shot "${shot.id}" did not finish`,
        context.signal,
      );
      tally.completed += 1;
      update(options, shot, 'complete', location.url);
      reportProgress(context);
    }
    return true;
  } catch (error) {
    if (isAbortError(error) || context.signal.aborted) throw error;
    const message = context.diagnostics.describe(error);
    tally.failures.push({ shotId: shot.id, currentUrl: location.url, message });
    update(options, shot, 'failed', location.url, message);
    reportProgress(context);
    return options.continueOnError;
  }
}

/** Navigates to the shot. Batch mode also runs readiness checks and profile actions. */
async function openShot(
  context: JobContext,
  shot: Shot,
  location: ShotLocation,
  signal: AbortSignal,
): Promise<void> {
  const { options, session, tracker, timeouts } = context;
  tracker.reset();
  update(options, shot, 'navigating', location.url);
  const navigation = await navigateAndWait(session, location.url, signal, timeouts.navigationMs);
  if (navigation.status !== undefined && navigation.status >= 400) {
    throw new Error(`Navigation returned HTTP ${navigation.status}.`);
  }
  await applyPageZoom(context.tabId, options.pageZoomPercent);
  if (options.onManualReady) {
    await settleBeforeManualPreparation(tracker, session, signal, timeouts.networkQuietMs);
    return;
  }
  update(options, shot, 'preparing', location.url);
  await tracker.waitForQuiet(signal, undefined, timeouts.networkQuietMs);
  await prepareDocument(session, signal);
  await waitForReadyConditions(session, shot.ready ?? [], signal);
  await runActions(shot.actions ?? [], createCdpActionDriver(session, signal), { signal });
}

/**
 * Hands the shot to the user until they move on. Each capture overwrites the
 * file; a failed attempt can be retried in place. Human preparation has no
 * deadline, but Stop or target closure still aborts it.
 */
async function captureWithPreparation(
  context: JobContext,
  shot: Shot,
  location: ShotLocation,
  awaitUser: NonNullable<CaptureJobOptions['onManualReady']>,
): Promise<void> {
  const { options, tally } = context;
  let saved = false;
  let lastFailure: CaptureFailure | undefined;
  for (;;) {
    update(options, shot, 'waiting', location.url);
    const action = await awaitUser(shot, context.signal);
    throwIfAborted(context.signal);
    if (action === 'next') break;
    try {
      await runWithTimeout(
        (signal) => captureAttempt(context, shot, location, signal, true),
        context.timeouts.shotMs,
        `Shot "${shot.id}" did not finish`,
        context.signal,
      );
      if (!saved) tally.completed += 1;
      saved = true;
      lastFailure = undefined;
      update(options, shot, 'complete', location.url);
      reportProgress(context);
    } catch (error) {
      if (isAbortError(error) || context.signal.aborted) throw error;
      lastFailure = {
        shotId: shot.id,
        currentUrl: location.url,
        message: context.diagnostics.describe(error),
      };
      update(options, shot, 'failed', location.url, lastFailure.message);
    }
    context.diagnostics.forgetForNextAttempt();
  }

  if (lastFailure) {
    // The latest attempt failed, so an earlier save no longer represents this shot.
    if (saved) tally.completed -= 1;
    tally.failures.push(lastFailure);
    update(options, shot, 'failed', location.url, lastFailure.message);
  } else if (!saved) {
    tally.skipped += 1;
    update(options, shot, 'skipped', location.url);
  } else {
    update(options, shot, 'complete', location.url);
  }
  reportProgress(context);
}

/** One capture: confirm the page, wait for it to be ready, screenshot, and download. */
async function captureAttempt(
  context: JobContext,
  shot: Shot,
  location: ShotLocation,
  signal: AbortSignal,
  manual: boolean,
): Promise<void> {
  const { options, session, timeouts } = context;
  const fullPage = Boolean(options.fullPage || shot.capture?.mode === 'full-page');
  let preparedScroll: ScrollPosition | undefined;
  try {
    if (context.windowId !== undefined) {
      await chrome.windows.update(context.windowId, { focused: true });
    }
    await session.send('Page.bringToFront');
    location.url = await evaluate<string>(session, 'location.href');
    if (new URL(normalizeLocalBaseUrl(location.url)).origin !== new URL(context.baseUrl).origin) {
      throw new Error(
        'The capture window left the selected localhost origin. Return to the application and retry.',
      );
    }
    update(options, shot, 'preparing', location.url);
    if (manual) {
      // Keep the user's framing. Full-page captures sweep, then restore it.
      await applyPageZoom(context.tabId, options.pageZoomPercent);
      preparedScroll = await prepareDocument(session, signal, true, fullPage, fullPage);
    } else {
      await context.tracker.waitForQuiet(signal, undefined, timeouts.networkQuietMs);
      if (fullPage) await prepareDocument(session, signal, false, true, true);
    }
    await waitForDocumentAssets(
      session,
      signal,
      timeouts.assetsMs,
      fullPage ? { mode: 'full-page' } : shot.capture,
    );
    await context.interceptor.waitForIdle(signal);
    if (!manual && shot.settleMs) await delay(shot.settleMs, signal);
    throwIfAborted(signal);
    await waitForPaint(session);
    throwIfAborted(signal);

    update(options, shot, 'capturing', location.url);
    const dataUrl = await captureShot(session, shot, {
      captureBeyondViewport: options.captureBeyondViewport,
      fullPage: options.fullPage,
      format: options.format,
    });
    if (preparedScroll) {
      await restoreDocumentScroll(session, preparedScroll);
      preparedScroll = undefined;
    }
    throwIfAborted(signal);

    update(options, shot, 'downloading', location.url);
    const downloadId = await downloadScreenshot(
      dataUrl,
      context.outputDirectory,
      outputFilename(shot.filename, options.format),
    );
    await waitForDownload(downloadId, signal);
    throwIfAborted(signal);
    options.onShotSaved?.(shot.id, dataUrl);
  } finally {
    if (preparedScroll) {
      await restoreDocumentScroll(session, preparedScroll).catch(() => undefined);
    }
  }
}

function reportProgress(context: JobContext): void {
  const { tally, options } = context;
  const total = options.shots.length;
  options.onProgress?.(
    Math.min(total, tally.completed + tally.skipped + tally.failures.length),
    total,
  );
}

const MANUAL_SETTLE_QUIET_CAP_MS = 5_000;

/**
 * A capture fired right after an in-window navigation can read a frame that
 * Chrome rendered at the real window size, tiled across the emulated viewport.
 * Page metrics look identical in good and bad frames, so the job prevents it:
 * after navigating, wait for local requests to settle and for a painted frame
 * before handing the shot to the user. A person is preparing the view, so a page
 * that keeps polling only shortens the wait; it never blocks the shot.
 */
async function settleBeforeManualPreparation(
  tracker: NetworkQuietTracker,
  session: DebuggerSession,
  signal: AbortSignal,
  networkQuietMs: number,
): Promise<void> {
  try {
    await tracker.waitForQuiet(
      signal,
      undefined,
      Math.min(networkQuietMs, MANUAL_SETTLE_QUIET_CAP_MS),
    );
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error;
  }
  await waitForPaint(session);
}

const UNCOMMITTED_TAB_ERROR = 'Cannot access contents of the page';

/**
 * A window created with `about:blank` briefly has no committed document. Chrome
 * rejects tab APIs during that moment with "Cannot access contents of the
 * page", about once in 40 attempts. Retry only that error, briefly.
 */
export async function retryWhileTabInitializes<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  attempts = 20,
  intervalMs = 50,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= attempts || !message.includes(UNCOMMITTED_TAB_ERROR)) throw error;
      await delay(intervalMs, signal);
    }
  }
}

async function runPreflight(
  context: JobContext,
  preflight: NonNullable<CaptureProfile['preflight']>,
): Promise<void> {
  const { session, tracker, timeouts, signal } = context;
  const url = new URL(preflight.path, context.baseUrl).href;
  tracker.reset();
  const navigation = await navigateAndWait(session, url, signal, timeouts.navigationMs);
  if (navigation.status !== undefined && navigation.status >= 400) {
    throw new Error(`Preflight failed with HTTP ${navigation.status}.`);
  }
  await tracker.waitForQuiet(signal, undefined, timeouts.networkQuietMs);
  const response = await evaluate<{ body: string }>(session, `({ body: document.body.innerText })`);
  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error('Preflight did not return valid JSON.');
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Preflight returned no status object.');
  }
  for (const [key, expectedValue] of Object.entries(preflight.expected)) {
    if ((payload as Record<string, unknown>)[key] !== expectedValue) {
      throw new Error(`Preflight refused capture: expected ${key}=${String(expectedValue)}.`);
    }
  }
}

function update(
  options: CaptureJobOptions,
  shot: Shot,
  status: ShotStatus,
  currentUrl: string,
  detail?: string,
): void {
  options.onShotUpdate?.({ shotId: shot.id, status, currentUrl, detail });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
