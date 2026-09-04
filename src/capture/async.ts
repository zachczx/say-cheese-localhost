export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Capture stopped.', 'AbortError');
}

export function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = globalThis.setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function runWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
  message: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  throwIfAborted(parentSignal);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  const timer = globalThis.setTimeout(
    () => controller.abort(new Error(`${message} (${milliseconds} ms).`)),
    milliseconds,
  );
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason instanceof Error) throw reason;
      throw new DOMException('Capture stopped.', 'AbortError');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

export function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Capture stopped.', 'AbortError');
}
