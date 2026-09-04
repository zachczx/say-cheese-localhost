import type { CaptureProfile, Shot, ViewportPreset } from '../profiles/schema';
import { delay, runWithTimeout, throwIfAborted } from './async';
import { runActions, createCdpActionDriver } from './actions';
import { DebuggerSession } from './debugger';
import { applyEmulation, clearEmulation } from './emulation';
import { navigateAndWait } from './navigation';
import {
  evaluate,
  NetworkQuietTracker,
  prepareDocument,
  waitForDocumentAssets,
  waitForReadyConditions,
} from './readiness';
import { RequestReplacementInterceptor } from './requests';
import { captureShot, downloadScreenshot, waitForDownload } from './screenshot';

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
  signal?: AbortSignal;
  onShotUpdate?: (update: ShotUpdate) => void;
  onManualReady?: (shot: Shot, signal: AbortSignal) => Promise<'capture' | 'next'>;
  onWarnings?: (warnings: string[]) => void;
  onProgress?: (completed: number, total: number) => void;
}

export interface CaptureJobResult {
  completed: number;
  skipped?: number;
  failures: CaptureFailure[];
  stopped: boolean;
  windowRetained: boolean;
}

const SHOT_TIMEOUT_MS = 45_000;

export async function runCaptureJob(options: CaptureJobOptions): Promise<CaptureJobResult> {
  const baseUrl = normalizeLocalBaseUrl(options.baseUrl);
  const failures: CaptureFailure[] = [];
  const jobController = new AbortController();
  const onExternalAbort = () => jobController.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  let captureWindowId: number | undefined;
  let session: DebuggerSession | undefined;
  let tracker: NetworkQuietTracker | undefined;
  let interceptor: RequestReplacementInterceptor | undefined;
  let stopped = false;
  let detached = false;
  let completed = 0;
  let skipped = 0;
  let unexpectedError: unknown;
  let windowRetained: boolean;
  const pageErrors: string[] = [];

  try {
    const captureWindow = await chrome.windows.create({
      url: 'about:blank',
      type: 'normal',
      focused: true,
      width: Math.max(640, options.viewport.width + 80),
      height: Math.max(640, options.viewport.height + 120),
    });
    if (!captureWindow) throw new Error('Chrome did not create a capture window.');
    captureWindowId = captureWindow.id;
    const tabId = captureWindow.tabs?.[0]?.id;
    if (tabId === undefined) throw new Error('Chrome did not create a capture tab.');

    await chrome.tabs.setZoom(tabId, 1);
    session = new DebuggerSession(tabId);
    await session.attach();
    session.onDetach((reason) => {
      detached = true;
      jobController.abort(new Error(`Chrome detached the capture debugger (${reason}).`));
    });
    const requests = new Map<string, string>();
    session.onEvent((event) => {
      if (event.method === 'Runtime.exceptionThrown') {
        pageErrors.push('The page raised an uncaught exception. Inspect the capture window.');
      }
      if (event.method === 'Network.requestWillBeSent') {
        const request = event.params.request as { url?: string } | undefined;
        if (['Fetch', 'XHR'].includes(String(event.params.type)) && request?.url) {
          try {
            const url = new URL(normalizeLocalBaseUrl(request.url));
            requests.set(String(event.params.requestId), url.origin + url.pathname);
          } catch {
            /* Optional remote services do not block a local capture. */
          }
        }
      }
      const requestId = String(event.params.requestId);
      const request = requests.get(requestId);
      if (request && event.method === 'Network.responseReceived') {
        const response = event.params.response as { status?: number } | undefined;
        if (response?.status && response.status >= 400) {
          pageErrors.push(`${request} returned HTTP ${response.status}.`);
        }
      }
      if (event.method === 'Network.loadingFailed' || event.method === 'Network.loadingFinished') {
        if (request && event.method === 'Network.loadingFailed' && !event.params.canceled) {
          pageErrors.push(`${request} could not load.`);
        }
        requests.delete(requestId);
      }
      if (pageErrors.length > 10) pageErrors.splice(0, pageErrors.length - 10);
      options.onWarnings?.([...new Set(pageErrors)]);
    });

    await Promise.all([
      session.send('Page.enable'),
      session.send('Runtime.enable'),
      session.send('Network.enable'),
      session.send('Log.enable'),
    ]);
    await session.send('Network.setBypassServiceWorker', { bypass: true });
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await applyEmulation(session, options.viewport);

    tracker = new NetworkQuietTracker();
    tracker.start(session);
    interceptor = new RequestReplacementInterceptor(
      session,
      options.profile.requestReplacements ?? [],
    );
    await interceptor.start();

    if (options.profile.preflight) {
      await runPreflight(
        session,
        tracker,
        baseUrl,
        options.profile.preflight.path,
        options.profile.preflight.expected,
        jobController.signal,
      );
    }

    options.onProgress?.(0, options.shots.length);
    for (const shot of options.shots) {
      throwIfAborted(jobController.signal);
      let currentUrl = new URL(shot.path, baseUrl).href;
      pageErrors.length = 0;
      requests.clear();
      options.onWarnings?.([]);
      try {
        await runWithTimeout(
          async (signal) => {
            tracker?.reset();
            update(options, shot, 'navigating', currentUrl);
            const navigation = await navigateAndWait(
              session as DebuggerSession,
              currentUrl,
              signal,
            );
            if (navigation.status !== undefined && navigation.status >= 400) {
              throw new Error(`Navigation returned HTTP ${navigation.status}.`);
            }
            if (!options.onManualReady) {
              update(options, shot, 'preparing', currentUrl);
              await tracker?.waitForQuiet(signal);
              await prepareDocument(session as DebuggerSession, signal);
              await waitForReadyConditions(session as DebuggerSession, shot.ready ?? [], signal);
              await runActions(
                shot.actions ?? [],
                createCdpActionDriver(session as DebuggerSession, signal),
                { signal },
              );
            }
          },
          SHOT_TIMEOUT_MS,
          `Could not open "${shot.id}"`,
          jobController.signal,
        );

        let saved = false;
        let lastFailure: CaptureFailure | undefined;
        do {
          // Human preparation has no deadline. Stop or target closure still aborts it.
          if (options.onManualReady) {
            update(options, shot, 'waiting', currentUrl);
            const action = await options.onManualReady(shot, jobController.signal);
            throwIfAborted(jobController.signal);
            if (action === 'next') break;
          }
          try {
            await runWithTimeout(
              async (signal) => {
                if (captureWindowId !== undefined)
                  await chrome.windows.update(captureWindowId, { focused: true });
                await (session as DebuggerSession).send('Page.bringToFront');
                currentUrl = await evaluate<string>(session as DebuggerSession, 'location.href');
                if (new URL(normalizeLocalBaseUrl(currentUrl)).origin !== new URL(baseUrl).origin) {
                  throw new Error(
                    'The capture window left the selected localhost origin. Return to the application and retry.',
                  );
                }
                update(options, shot, 'preparing', currentUrl);
                if (options.onManualReady)
                  await prepareDocument(session as DebuggerSession, signal, true);
                else await tracker?.waitForQuiet(signal);
                await waitForDocumentAssets(
                  session as DebuggerSession,
                  signal,
                  15_000,
                  shot.capture,
                );
                await interceptor?.waitForIdle(signal);
                if (!options.onManualReady && shot.settleMs) await delay(shot.settleMs, signal);
                throwIfAborted(signal);
                update(options, shot, 'capturing', currentUrl);
                const dataUrl = await captureShot(session as DebuggerSession, shot, {
                  captureBeyondViewport: options.captureBeyondViewport,
                });
                throwIfAborted(signal);
                update(options, shot, 'downloading', currentUrl);
                const downloadId = await downloadScreenshot(
                  dataUrl,
                  options.profile.outputDirectory,
                  shot.filename,
                );
                await waitForDownload(downloadId, signal);
                throwIfAborted(signal);
              },
              SHOT_TIMEOUT_MS,
              `Shot "${shot.id}" did not finish`,
              jobController.signal,
            );
            if (!saved) completed += 1;
            saved = true;
            lastFailure = undefined;
            update(options, shot, 'complete', currentUrl);
            options.onProgress?.(completed + skipped + failures.length, options.shots.length);
          } catch (error) {
            if (isAbortError(error) || jobController.signal.aborted) throw error;
            if (!options.onManualReady) throw error;
            lastFailure = {
              shotId: shot.id,
              currentUrl,
              message: formatShotError(error, pageErrors),
            };
            update(options, shot, 'failed', currentUrl, lastFailure.message);
          }
          // Diagnostics belong to the next attempt from this point forward.
          pageErrors.length = 0;
          requests.clear();
        } while (options.onManualReady);

        if (lastFailure) {
          if (saved) completed -= 1;
          failures.push(lastFailure);
          update(options, shot, 'failed', currentUrl, lastFailure.message);
        } else if (!saved) {
          skipped += 1;
          update(options, shot, 'skipped', currentUrl);
        } else {
          update(options, shot, 'complete', currentUrl);
        }
        options.onProgress?.(
          Math.min(options.shots.length, completed + skipped + failures.length),
          options.shots.length,
        );
      } catch (error) {
        if (isAbortError(error) || jobController.signal.aborted) throw error;
        const message = formatShotError(error, pageErrors);
        failures.push({ shotId: shot.id, currentUrl, message });
        update(options, shot, 'failed', currentUrl, message);
        options.onProgress?.(completed + skipped + failures.length, options.shots.length);
        if (!options.continueOnError) break;
      }
    }
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) stopped = true;
    else if (jobController.signal.aborted && !detached) stopped = true;
    else unexpectedError = error;
  } finally {
    options.signal?.removeEventListener('abort', onExternalAbort);
    tracker?.stop();
    await interceptor?.stop().catch(() => undefined);
    if (session?.attached) {
      await session
        .send('Network.setBypassServiceWorker', { bypass: false })
        .catch(() => undefined);
      await clearEmulation(session);
      await session.detach().catch(() => undefined);
    }
    windowRetained =
      (failures.length > 0 || unexpectedError !== undefined) &&
      options.retainWindowAfterFailure &&
      !stopped;
    if (!windowRetained && captureWindowId !== undefined) {
      await chrome.windows.remove(captureWindowId).catch(() => undefined);
    }
  }

  if (unexpectedError !== undefined) throw unexpectedError;

  return { completed, skipped, failures, stopped, windowRetained };
}

export function normalizeLocalBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Base URL must be a valid HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Base URL must use HTTP or HTTPS.');
  }
  const hostname = url.hostname.toLowerCase();
  const isLoopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]';
  if (!isLoopback) throw new Error('Base URL must point to localhost or a loopback address.');
  url.hash = '';
  return url.href;
}

async function runPreflight(
  session: DebuggerSession,
  tracker: NetworkQuietTracker,
  baseUrl: string,
  path: string,
  expected: Record<string, string | number | boolean>,
  signal: AbortSignal,
): Promise<void> {
  const url = new URL(path, baseUrl).href;
  tracker.reset();
  const navigation = await navigateAndWait(session, url, signal);
  if (navigation.status !== undefined && navigation.status >= 400) {
    throw new Error(`Preflight failed with HTTP ${navigation.status}.`);
  }
  await tracker.waitForQuiet(signal);
  const response = await evaluate<{ body: string }>(session, `({ body: document.body.innerText })`);
  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error('Preflight did not return valid JSON.');
  }
  if (!payload || typeof payload !== 'object')
    throw new Error('Preflight returned no status object.');
  for (const [key, expectedValue] of Object.entries(expected)) {
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

function formatShotError(error: unknown, pageErrors: string[]): string {
  const message = error instanceof Error ? error.message : String(error);
  const pageDetail =
    pageErrors.length > 0 ? ` Page errors: ${pageErrors.slice(-3).join(' | ')}` : '';
  return `${message}${pageDetail}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
