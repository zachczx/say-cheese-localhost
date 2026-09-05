import { normalizeLocalBaseUrl } from './job';

export interface PingResult {
  reachable: boolean;
  latencyMs: number;
  status?: number;
  statusText?: string;
  error?: string;
  timestamp: number;
}

export interface PingOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function pingAddress(rawUrl: string, options: PingOptions = {}): Promise<PingResult> {
  const timestamp = Date.now();
  let targetUrl: string;
  try {
    targetUrl = normalizeLocalBaseUrl(rawUrl);
  } catch (error) {
    return {
      reachable: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
      timestamp,
    };
  }

  const timeoutMs = options.timeoutMs ?? 2500;
  const start = performance.now();
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    controller.abort(options.signal.reason);
  } else {
    options.signal?.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    controller.abort(new DOMException('Connection timed out', 'TimeoutError'));
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(targetUrl, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (fetchErr) {
      if (controller.signal.aborted) throw fetchErr;
      // If CORS prevented standard inspection, attempt no-cors mode to verify if the server is listening
      response = await fetch(targetUrl, {
        method: 'GET',
        mode: 'no-cors',
        signal: controller.signal,
        cache: 'no-store',
      });
    }

    const latencyMs = Math.round(performance.now() - start);
    void response.body?.cancel();

    return {
      reachable: true,
      latencyMs,
      status: response.status > 0 ? response.status : undefined,
      statusText: response.statusText || (response.status > 0 ? undefined : 'Connected'),
      timestamp,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    const isAborted = Boolean(options.signal?.aborted);
    const isTimeout =
      (err instanceof DOMException && err.name === 'TimeoutError') ||
      message.toLowerCase().includes('timed out');

    let errorReason = 'Connection refused or unreachable';
    if (isAborted) {
      errorReason = 'Request aborted';
    } else if (isTimeout) {
      errorReason = 'Connection timed out';
    }

    return {
      reachable: false,
      latencyMs,
      error: errorReason,
      timestamp,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}
