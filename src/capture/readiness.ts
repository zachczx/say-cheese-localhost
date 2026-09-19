import type { ReadyCondition, Shot } from '../profiles/schema';
import { delay, runWithTimeout, throwIfAborted } from './async';
import type { DebuggerEvent, DebuggerSession } from './debugger';

interface RuntimeResult<T> {
  result: { value?: T; description?: string; subtype?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

export interface ScrollPosition {
  x: number;
  y: number;
}

export class NetworkQuietTracker {
  #pending = new Map<string, string>();
  #lastActivity = Date.now();
  #unsubscribe: (() => void) | undefined;

  start(session: DebuggerSession): void {
    this.#unsubscribe = session.onEvent((event) => this.#handleEvent(event));
  }

  reset(): void {
    this.#pending.clear();
    this.#lastActivity = Date.now();
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#pending.clear();
  }

  async waitForQuiet(signal?: AbortSignal, quietMs = 500, timeoutMs = 15_000): Promise<void> {
    try {
      await runWithTimeout(
        async (timeoutSignal) => {
          while (this.#pending.size > 0 || Date.now() - this.#lastActivity < quietMs) {
            await delay(50, timeoutSignal);
          }
        },
        timeoutMs,
        'Network did not become quiet',
        signal,
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      const pending = [...new Set(this.#pending.values())].slice(0, 5);
      const detail = pending.length
        ? ` Pending requests: ${pending.join(', ')}.`
        : ' Page requests kept restarting before the quiet period elapsed.';
      throw new Error(`${error instanceof Error ? error.message : String(error)}${detail}`, {
        cause: error,
      });
    }
  }

  #handleEvent(event: DebuggerEvent): void {
    if (event.method === 'Network.requestWillBeSent') {
      const requestId = event.params.requestId;
      const type = event.params.type;
      const request = event.params.request as { url?: string } | undefined;
      if (typeof requestId !== 'string') return;
      // Redirects reuse request IDs, including redirects to an ignored service.
      if (this.#pending.delete(requestId)) this.#lastActivity = Date.now();
      let url: URL;
      try {
        url = new URL(request?.url ?? '');
      } catch {
        return;
      }
      if (!['http:', 'https:'].includes(url.protocol)) return;
      const local =
        url.hostname === 'localhost' ||
        url.hostname.endsWith('.localhost') ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]';
      // Visible images/fonts have their own readiness gate. Remote API calls
      // (analytics, optional services) must not hold a localhost capture open.
      if (
        ['Document', 'Script', 'Stylesheet'].includes(String(type)) ||
        (local && ['Fetch', 'XHR'].includes(String(type)))
      ) {
        this.#pending.set(requestId, `${String(type)} ${url.origin}${url.pathname}`);
        this.#lastActivity = Date.now();
      }
    }
    if (event.method === 'Network.responseReceived') {
      const response = event.params.response as { mimeType?: string } | undefined;
      // Fetch-based event streams can be reported as Fetch rather than EventSource.
      if (response?.mimeType?.split(';')[0]?.trim() === 'text/event-stream') {
        if (this.#pending.delete(String(event.params.requestId))) this.#lastActivity = Date.now();
      }
    }
    if (event.method === 'Network.loadingFinished' || event.method === 'Network.loadingFailed') {
      const requestId = event.params.requestId;
      if (typeof requestId === 'string' && this.#pending.delete(requestId)) {
        this.#lastActivity = Date.now();
      }
    }
  }
}

export async function evaluate<T>(
  session: DebuggerSession,
  expression: string,
  awaitPromise = false,
): Promise<T> {
  const response = await session.send<RuntimeResult<T>>('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    const details =
      response.exceptionDetails.exception?.description ??
      response.exceptionDetails.text ??
      response.result.description ??
      'Unknown page error';
    throw new Error(details);
  }
  return response.result.value as T;
}

export async function waitForSelector(
  session: DebuggerSession,
  selector: string,
  timeoutMs = 15_000,
  signal?: AbortSignal,
): Promise<void> {
  await runWithTimeout(
    async (timeoutSignal) => {
      while (
        !(await evaluate<boolean>(
          session,
          `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
        ))
      ) {
        await delay(50, timeoutSignal);
      }
    },
    timeoutMs,
    `Selector not found: ${selector}`,
    signal,
  );
}

export async function waitForReadyConditions(
  session: DebuggerSession,
  conditions: ReadyCondition[],
  signal?: AbortSignal,
): Promise<void> {
  for (const condition of conditions) {
    throwIfAborted(signal);
    if (condition.type === 'selector') {
      await waitForSelector(session, condition.selector, condition.timeoutMs, signal);
      continue;
    }
    const timeoutMs = condition.timeoutMs ?? 15_000;
    const matcher = wildcardToRegExp(condition.pattern);
    await runWithTimeout(
      async (timeoutSignal) => {
        while (!matcher.test(await evaluate<string>(session, 'location.href'))) {
          await delay(100, timeoutSignal);
        }
      },
      timeoutMs,
      `URL did not match "${condition.pattern}"`,
      signal,
    );
  }
}

export async function prepareDocument(
  session: DebuggerSession,
  signal?: AbortSignal,
  preserveFraming = false,
  sweepDocument = !preserveFraming,
  requireCompleteSweep = false,
): Promise<ScrollPosition | undefined> {
  throwIfAborted(signal);
  const originalScroll = await evaluate<ScrollPosition | null>(
    session,
    `(async () => {
      const id = 'say-cheese-localhost-capture-style';
      document.getElementById(id)?.remove();
      const style = document.createElement('style');
      style.id = id;
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important;scrollbar-width:none!important}::-webkit-scrollbar{width:0!important;height:0!important}';
      document.head.append(style);
      const originalScroll = { x: scrollX, y: scrollY };
      if (!${sweepDocument}) return null;
      if (!${preserveFraming}) window.focus();
      window.scrollTo(0, 0);

      const nextFrame = () => new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const step = Math.max(240, Math.floor(innerHeight * 0.8));
      const requireCompleteSweep = ${requireCompleteSweep};
      const startedAt = performance.now();
      let y = 0;
      let stableBottomChecks = 0;
      let reachedStableBottom = false;
      const maxSteps = requireCompleteSweep ? 400 : 24;
      for (let index = 0; index < maxSteps && performance.now() - startedAt < 10_000; index += 1) {
        const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
        if (y < maxY) {
          y = Math.min(maxY, y + step);
          stableBottomChecks = 0;
          window.scrollTo(0, y);
          await nextFrame();
          continue;
        }

        await new Promise((resolve) => setTimeout(resolve, requireCompleteSweep ? 50 : 0));
        await nextFrame();
        const nextMaxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
        if (nextMaxY <= maxY) {
          stableBottomChecks += 1;
          if (!requireCompleteSweep || stableBottomChecks >= 3) {
            reachedStableBottom = true;
            break;
          }
        } else {
          stableBottomChecks = 0;
        }
      }

      if (requireCompleteSweep && !reachedStableBottom) {
        throw new Error('The document kept growing or was too tall to sweep completely.');
      }

      window.scrollTo(0, 0);
      await nextFrame();
      return ${preserveFraming} ? originalScroll : null;
    })()`,
    true,
  );
  return originalScroll ?? undefined;
}

export async function restoreDocumentScroll(
  session: DebuggerSession,
  position: ScrollPosition,
): Promise<void> {
  await evaluate(session, `window.scrollTo(${position.x}, ${position.y})`);
}

export async function waitForDocumentAssets(
  session: DebuggerSession,
  signal?: AbortSignal,
  timeoutMs = 15_000,
  capture?: Shot['capture'],
): Promise<void> {
  const visibleImages = `Array.from(document.images).filter((image) => {
    const capture = ${JSON.stringify(capture ?? { mode: 'viewport' })};
    let area = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
    if (capture.mode === 'full-page') {
      area = { top: -scrollY, left: -scrollX,
        bottom: document.documentElement.scrollHeight - scrollY,
        right: document.documentElement.scrollWidth - scrollX };
    } else if (capture.mode === 'element') {
      const element = document.querySelector(capture.selector);
      if (!element) throw new Error('Capture element is missing. Prepare the screen and retry.');
      area = element.getBoundingClientRect();
    }
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= area.top ||
        rect.top >= area.bottom || rect.right <= area.left || rect.left >= area.right) return false;
    for (let element = image; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          style.visibility === 'collapse' || style.opacity === '0') return false;
    }
    return true;
  })`;
  await runWithTimeout(
    async (timeoutSignal) => {
      while (true) {
        throwIfAborted(timeoutSignal);
        const state = await evaluate<{ ready: boolean; broken: number }>(
          session,
          `(() => {
            const images = ${visibleImages};
            return {
              ready: (document.fonts?.status ?? 'loaded') === 'loaded' && images.every((image) => image.complete),
              broken: images.filter((image) => image.complete &&
                (image.naturalWidth <= 0 || image.naturalHeight <= 0)).length,
            };
          })()`,
        );
        if (state.broken > 0) {
          throw new Error(
            `${state.broken} image(s) in the capture area failed to load. Reload or fix the images, then retry.`,
          );
        }
        if (state.ready) break;
        await delay(75, timeoutSignal);
      }
      const decoded = await evaluate<boolean>(
        session,
        `(async () => {
          let timer;
          try {
            return await Promise.race([
              Promise.all(${visibleImages}.map(async (image) => {
                if (typeof image.decode === 'function') await image.decode();
                return image.naturalWidth > 0 && image.naturalHeight > 0;
              })).then((results) => results.every(Boolean), () => false),
              new Promise((resolve) => { timer = setTimeout(() => resolve(false), 1000); }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        })()`,
        true,
      );
      throwIfAborted(timeoutSignal);
      if (!decoded) {
        throw new Error(
          'Images in the capture area could not be decoded. Reload or fix the images, then retry.',
        );
      }
    },
    timeoutMs,
    'Fonts or images in the capture area did not become ready',
    signal,
  );
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
