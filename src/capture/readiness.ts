import type { ReadyCondition } from '../profiles/schema';
import { delay, runWithTimeout, throwIfAborted } from './async';
import type { DebuggerEvent, DebuggerSession } from './debugger';

interface RuntimeResult<T> {
  result: { value?: T; description?: string; subtype?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

export class NetworkQuietTracker {
  #pending = new Set<string>();
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
  }

  #handleEvent(event: DebuggerEvent): void {
    if (event.method === 'Network.requestWillBeSent') {
      const requestId = event.params.requestId;
      const type = event.params.type;
      if (
        typeof requestId === 'string' &&
        type !== 'WebSocket' &&
        type !== 'EventSource' &&
        type !== 'Ping'
      ) {
        this.#pending.add(requestId);
        this.#lastActivity = Date.now();
      }
    }
    if (event.method === 'Network.loadingFinished' || event.method === 'Network.loadingFailed') {
      const requestId = event.params.requestId;
      if (typeof requestId === 'string') {
        this.#pending.delete(requestId);
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
): Promise<void> {
  throwIfAborted(signal);
  await evaluate(
    session,
    `(() => {
      const id = 'say-cheese-localhost-capture-style';
      document.getElementById(id)?.remove();
      const style = document.createElement('style');
      style.id = id;
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important;scrollbar-width:none!important}::-webkit-scrollbar{width:0!important;height:0!important}';
      document.head.append(style);
      window.focus();
      window.scrollTo(0, 0);
      document.documentElement.style.zoom = '1';
      return true;
    })()`,
  );
}

export async function waitForDocumentAssets(
  session: DebuggerSession,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<void> {
  const visibleImages = `Array.from(document.images).filter((image) => {
    const rect = image.getBoundingClientRect();
    return rect.bottom >= 0 && rect.top <= innerHeight && rect.right >= 0 && rect.left <= innerWidth;
  })`;
  await runWithTimeout(
    async (timeoutSignal) => {
      while (
        !(await evaluate<boolean>(
          session,
          `(document.fonts?.status ?? 'loaded') === 'loaded' && ${visibleImages}.every((image) => image.complete)`,
        ))
      ) {
        await delay(75, timeoutSignal);
      }
      await evaluate(
        session,
        `(() => Promise.race([
          Promise.allSettled(${visibleImages}.map((image) => typeof image.decode === 'function' ? image.decode() : Promise.resolve())),
          new Promise((resolve) => setTimeout(resolve, 1000))
        ]).then(() => true))()`,
        true,
      );
    },
    timeoutMs,
    'Fonts or visible images did not become ready',
    signal,
  );
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
