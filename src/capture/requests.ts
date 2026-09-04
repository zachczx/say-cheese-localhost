import type { RequestReplacement } from '../profiles/schema';
import { delay, runWithTimeout } from './async';
import type { DebuggerEvent, DebuggerSession } from './debugger';

interface PausedRequest {
  requestId: string;
  request: { url: string };
}

export function matchesUrlPattern(url: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(url);
}

export function deterministicAsset(url: string, assetPaths: readonly string[]): string {
  if (assetPaths.length === 0) throw new Error('Replacement requires at least one asset.');
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return assetPaths[(hash >>> 0) % assetPaths.length] as string;
}

export class RequestReplacementInterceptor {
  #unsubscribe: (() => void) | undefined;
  #pending = new Set<Promise<void>>();
  #error: Error | undefined;

  constructor(
    private readonly session: DebuggerSession,
    private readonly replacements: RequestReplacement[],
    private readonly onError?: (error: Error) => void,
  ) {}

  async start(): Promise<void> {
    if (this.replacements.length === 0) return;
    await this.session.send('Fetch.enable', {
      patterns: this.replacements.map((replacement) => ({
        urlPattern: replacement.urlPattern,
        requestStage: 'Request',
      })),
    });
    this.#unsubscribe = this.session.onEvent((event) => this.#onEvent(event));
  }

  async stop(): Promise<void> {
    if (!this.#unsubscribe) return;
    await Promise.allSettled([...this.#pending]);
    await this.session.send('Fetch.disable').catch(() => undefined);
    this.#unsubscribe();
    this.#unsubscribe = undefined;
  }

  async waitForIdle(signal?: AbortSignal, timeoutMs = 15_000): Promise<void> {
    await runWithTimeout(
      async (timeoutSignal) => {
        while (this.#pending.size > 0) await delay(25, timeoutSignal);
      },
      timeoutMs,
      'Image request replacement did not finish',
      signal,
    );
    if (this.#error) throw this.#error;
  }

  #onEvent(event: DebuggerEvent): void {
    if (event.method !== 'Fetch.requestPaused') return;
    const task = this.#replace(event.params as unknown as PausedRequest)
      .catch((error: unknown) => {
        this.#error = error instanceof Error ? error : new Error(String(error));
        this.onError?.(this.#error);
      })
      .finally(() => this.#pending.delete(task));
    this.#pending.add(task);
  }

  async #replace(paused: PausedRequest): Promise<void> {
    const replacement = this.replacements.find((candidate) =>
      matchesUrlPattern(paused.request.url, candidate.urlPattern),
    );
    if (!replacement) {
      await this.session.send('Fetch.continueRequest', { requestId: paused.requestId });
      return;
    }

    const assetPath = deterministicAsset(paused.request.url, replacement.assetPaths);
    try {
      const response = await fetch(chrome.runtime.getURL(assetPath));
      if (!response.ok) throw new Error(`Bundled replacement not found: ${assetPath}`);
      const body = arrayBufferToBase64(await response.arrayBuffer());
      await this.session.send('Fetch.fulfillRequest', {
        requestId: paused.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: mimeTypeFor(assetPath) },
          { name: 'Cache-Control', value: 'no-store' },
        ],
        body,
      });
    } catch (error) {
      await this.session
        .send('Fetch.failRequest', { requestId: paused.requestId, errorReason: 'BlockedByClient' })
        .catch(() => undefined);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Private image replacement failed for ${paused.request.url}: ${detail}`, {
        cause: error,
      });
    }
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function mimeTypeFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}
