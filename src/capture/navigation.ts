import { abortError, runWithTimeout } from './async';
import type { DebuggerSession } from './debugger';

interface NavigationResult {
  errorText?: string;
}

export interface NavigationOutcome {
  status?: number;
}

export async function navigateAndWait(
  session: DebuggerSession,
  url: string,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<NavigationOutcome> {
  return runWithTimeout(
    async (timeoutSignal) => {
      let unsubscribe: () => void = () => undefined;
      let removeAbort: () => void = () => undefined;
      let status: number | undefined;
      try {
        const loaded = new Promise<void>((resolve, reject) => {
          unsubscribe = session.onEvent((event) => {
            if (event.method === 'Network.responseReceived') {
              const type = event.params.type;
              const response = event.params.response as
                { url?: string; status?: number } | undefined;
              if (type === 'Document' && response?.url === url) status = response.status;
            }
            if (event.method === 'Page.loadEventFired') resolve();
          });
          const onAbort = () => reject(abortError(timeoutSignal));
          timeoutSignal.addEventListener('abort', onAbort, { once: true });
          removeAbort = () => timeoutSignal.removeEventListener('abort', onAbort);
        });
        const result = await session.send<NavigationResult>('Page.navigate', { url });
        if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
        await loaded;
        return { status };
      } finally {
        unsubscribe();
        removeAbort();
      }
    },
    timeoutMs,
    `Navigation did not finish for ${url}`,
    signal,
  );
}
