import type { Shot } from '../profiles/schema';
import { joinDownloadPath } from '../profiles/schema';
import type { DebuggerSession } from './debugger';
import { abortError, runWithTimeout } from './async';
import { evaluate } from './readiness';

interface ScreenshotResult {
  data: string;
}

interface LayoutMetrics {
  cssContentSize: { width: number; height: number };
}

interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureShotOptions {
  captureBeyondViewport?: boolean;
}

export async function captureShot(
  session: DebuggerSession,
  shot: Shot,
  options?: CaptureShotOptions,
): Promise<string> {
  const mode = shot.capture?.mode ?? 'viewport';
  const captureBeyondViewport =
    shot.capture?.captureBeyondViewport ?? options?.captureBeyondViewport ?? false;

  const params: Record<string, unknown> = {
    format: 'webp',
    quality: 100,
    fromSurface: true,
    captureBeyondViewport,
  };

  let preparedScroll: { x: number; y: number } | null = null;

  if (mode === 'viewport') {
    // When captureBeyondViewport is false and clip is omitted, Chromium captures
    // the emulated viewport directly, preserving fixed elements (such as top bars
    // and bottom navigation bars) pinned to the viewport instead of expanding layout
    // to document height.
    if (captureBeyondViewport) {
      params.clip = await evaluate<ElementRect & { scale: number }>(
        session,
        '({ x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, scale: 1 })',
      );
    } else {
      preparedScroll = await evaluate<{ x: number; y: number }>(
        session,
        '({ x: scrollX, y: scrollY })',
      );
    }
  }

  if (mode === 'full-page') {
    const metrics = await session.send<LayoutMetrics>('Page.getLayoutMetrics');
    params.clip = { x: 0, y: 0, ...metrics.cssContentSize, scale: 1 };
  }

  if (mode === 'element') {
    const selector = shot.capture?.selector;
    if (!selector) throw new Error('Element capture requires a selector.');
    const rect = await evaluate<ElementRect | null>(
      session,
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height };
      })()`,
    );
    if (!rect) throw new Error(`Element capture selector not found: ${selector}`);
    params.clip = { ...rect, scale: 1 };
  }

  try {
    const result = await session.send<ScreenshotResult>('Page.captureScreenshot', params);
    return `data:image/webp;base64,${result.data}`;
  } finally {
    if (mode === 'viewport') {
      if (!captureBeyondViewport && preparedScroll) {
        await evaluate(session, `window.scrollTo(${preparedScroll.x}, ${preparedScroll.y})`);
      } else if (captureBeyondViewport && params.clip) {
        const clip = params.clip as ElementRect;
        await evaluate(session, `window.scrollTo(${clip.x}, ${clip.y})`);
      }
    }
  }
}

export async function downloadScreenshot(
  dataUrl: string,
  outputDirectory: string,
  filename: string,
): Promise<number> {
  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename: joinDownloadPath(outputDirectory, filename),
    conflictAction: 'overwrite',
    saveAs: false,
  });
  return downloadId;
}

export async function waitForDownload(
  downloadId: number,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<void> {
  await runWithTimeout(
    async (timeoutSignal) => {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          chrome.downloads.onChanged.removeListener(onChanged);
          timeoutSignal.removeEventListener('abort', onAbort);
        };
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) reject(error);
          else resolve();
        };
        const onChanged = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id !== downloadId) return;
          if (delta.error?.current) finish(new Error(`Download failed: ${delta.error.current}.`));
          if (delta.state?.current === 'complete') finish();
          if (delta.state?.current === 'interrupted')
            finish(new Error('Download was interrupted.'));
        };
        const onAbort = () => finish(abortError(timeoutSignal));
        chrome.downloads.onChanged.addListener(onChanged);
        timeoutSignal.addEventListener('abort', onAbort, { once: true });

        void chrome.downloads.search({ id: downloadId }).then(
          ([item]) => {
            if (!item) finish(new Error('Chrome did not retain the download record.'));
            else if (item.error) finish(new Error(`Download failed: ${item.error}.`));
            else if (item.state === 'complete') finish();
            else if (item.state === 'interrupted') finish(new Error('Download was interrupted.'));
          },
          (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
        );
      });
    },
    timeoutMs,
    'Download did not finish',
    signal,
  );
}
