import type { DebuggerEvent } from './debugger';
import { normalizeLocalBaseUrl } from './url';

const MAX_PAGE_ERRORS = 10;

/**
 * Collects page problems worth a human look during a shot: uncaught exceptions
 * and failed local API requests. Query strings are dropped from request URLs so
 * credentials never reach the controller.
 */
export class PageDiagnostics {
  readonly #errors: string[] = [];
  readonly #requests = new Map<string, string>();
  readonly #report: (warnings: readonly string[]) => void;

  constructor(onWarnings?: (warnings: string[]) => void) {
    this.#report = createWarningReporter(onWarnings);
  }

  handle(event: DebuggerEvent): void {
    if (event.method === 'Runtime.exceptionThrown') {
      this.#errors.push(describePageException(event.params));
    }
    if (event.method === 'Network.requestWillBeSent') {
      const request = event.params.request as { url?: string } | undefined;
      if (['Fetch', 'XHR'].includes(String(event.params.type)) && request?.url) {
        try {
          const url = new URL(normalizeLocalBaseUrl(request.url));
          this.#requests.set(String(event.params.requestId), url.origin + url.pathname);
        } catch {
          /* Optional remote services do not block a local capture. */
        }
      }
    }
    const requestId = String(event.params.requestId);
    const request = this.#requests.get(requestId);
    if (request && event.method === 'Network.responseReceived') {
      const response = event.params.response as { status?: number } | undefined;
      if (response?.status && response.status >= 400) {
        this.#errors.push(`${request} returned HTTP ${response.status}.`);
      }
    }
    if (event.method === 'Network.loadingFailed' || event.method === 'Network.loadingFinished') {
      if (request && event.method === 'Network.loadingFailed' && !event.params.canceled) {
        this.#errors.push(`${request} could not load.`);
      }
      this.#requests.delete(requestId);
    }
    if (this.#errors.length > MAX_PAGE_ERRORS) {
      this.#errors.splice(0, this.#errors.length - MAX_PAGE_ERRORS);
    }
    this.#report(this.#errors);
  }

  /** Starts a new shot: forget earlier problems and clear the controller's list. */
  reset(): void {
    this.#forget();
    this.#report([]);
  }

  /** Diagnostics belong to the next attempt from this point forward. */
  #forget(): void {
    this.#errors.length = 0;
    this.#requests.clear();
  }

  forgetForNextAttempt(): void {
    this.#forget();
  }

  /** An error message with the latest page problems appended. */
  describe(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const pageDetail =
      this.#errors.length > 0 ? ` Page errors: ${this.#errors.slice(-3).join(' | ')}` : '';
    return `${message}${pageDetail}`;
  }
}

/**
 * Keeps the first line of an uncaught exception (for example
 * "TypeError: x is undefined") so the warning is actionable. Stack frames are
 * dropped because they carry script URLs and add noise.
 */
export function describePageException(params: Record<string, unknown>): string {
  const details = params.exceptionDetails as
    { text?: string; exception?: { description?: string; value?: unknown } } | undefined;
  const raw =
    details?.exception?.description ??
    (typeof details?.exception?.value === 'string' ? details.exception.value : undefined) ??
    details?.text;
  const firstLine = raw?.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine || firstLine === 'Uncaught') {
    return 'The page raised an uncaught exception. Inspect the capture window.';
  }
  const message = firstLine.length > 200 ? `${firstLine.slice(0, 199)}…` : firstLine;
  return `Uncaught exception: ${message}`;
}

/**
 * Debugger events arrive hundreds of times per page load. Only notify the
 * controller when the de-duplicated warning list actually changes.
 */
function createWarningReporter(
  onWarnings?: (warnings: string[]) => void,
): (warnings: readonly string[]) => void {
  let previous: string | undefined;
  return (warnings) => {
    const unique = [...new Set(warnings)];
    const key = JSON.stringify(unique);
    if (key === previous) return;
    previous = key;
    onWarnings?.(unique);
  };
}
