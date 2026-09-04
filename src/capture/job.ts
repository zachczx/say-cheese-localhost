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
  'pending' | 'navigating' | 'preparing' | 'capturing' | 'downloading' | 'complete' | 'failed';

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
  signal?: AbortSignal;
  onShotUpdate?: (update: ShotUpdate) => void;
  onProgress?: (completed: number, total: number) => void;
}

export interface CaptureJobResult {
  completed: number;
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
    session.onEvent((event) => {
      if (event.method === 'Runtime.exceptionThrown') {
        const details = event.params.exceptionDetails as
          { text?: string; exception?: { description?: string } } | undefined;
        pageErrors.push(details?.exception?.description ?? details?.text ?? 'Page exception');
      }
      if (event.method === 'Log.entryAdded') {
        const entry = event.params.entry as { level?: string; text?: string } | undefined;
        if (entry?.level === 'error' && entry.text) pageErrors.push(entry.text);
      }
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
      const currentUrl = new URL(shot.path, baseUrl).href;
      pageErrors.length = 0;

      try {
        await runWithTimeout(
          async (shotSignal) => {
            tracker?.reset();
            update(options, shot, 'navigating', currentUrl);
            const navigation = await navigateAndWait(
              session as DebuggerSession,
              currentUrl,
              shotSignal,
            );
            if (navigation.status !== undefined && navigation.status >= 400) {
              throw new Error(`Navigation returned HTTP ${navigation.status}.`);
            }

            update(options, shot, 'preparing', currentUrl);
            await tracker?.waitForQuiet(shotSignal);
            await prepareDocument(session as DebuggerSession, shotSignal);
            await waitForReadyConditions(session as DebuggerSession, shot.ready ?? [], shotSignal);
            await runActions(
              shot.actions ?? [],
              createCdpActionDriver(session as DebuggerSession, shotSignal),
              { signal: shotSignal },
            );
            await tracker?.waitForQuiet(shotSignal);
            await waitForDocumentAssets(session as DebuggerSession, shotSignal);
            await interceptor?.waitForIdle(shotSignal);
            if (shot.settleMs) await delay(shot.settleMs, shotSignal);

            if (captureWindowId !== undefined) {
              await chrome.windows.update(captureWindowId, { focused: true });
            }
            await (session as DebuggerSession).send('Page.bringToFront');
            update(options, shot, 'capturing', currentUrl);
            const dataUrl = await captureShot(session as DebuggerSession, shot);
            update(options, shot, 'downloading', currentUrl);
            const downloadId = await downloadScreenshot(
              dataUrl,
              options.profile.outputDirectory,
              shot.filename,
            );
            await waitForDownload(downloadId, shotSignal);
          },
          SHOT_TIMEOUT_MS,
          `Shot "${shot.id}" did not finish`,
          jobController.signal,
        );
        completed += 1;
        update(options, shot, 'complete', currentUrl);
        options.onProgress?.(completed + failures.length, options.shots.length);
      } catch (error) {
        if (isAbortError(error) || jobController.signal.aborted) throw error;
        const message = formatShotError(error, pageErrors);
        failures.push({ shotId: shot.id, currentUrl, message });
        update(options, shot, 'failed', currentUrl, message);
        options.onProgress?.(completed + failures.length, options.shots.length);
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

  return { completed, failures, stopped, windowRetained };
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
