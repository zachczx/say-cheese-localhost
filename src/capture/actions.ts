import type { CaptureAction } from '../profiles/schema';
import { delay, throwIfAborted } from './async';
import type { DebuggerSession } from './debugger';
import { evaluate, waitForSelector } from './readiness';

export interface ActionDriver {
  waitForSelector(selector: string, timeoutMs?: number): Promise<void>;
  click(selector: string): Promise<void>;
  selectIndex(selector: string, index: number): Promise<void>;
  scrollTo(selector: string, topOffset?: number): Promise<void>;
  waitForUrl(pattern: string, timeoutMs?: number): Promise<void>;
  delay(milliseconds: number): Promise<void>;
}

export async function runActions(
  actions: CaptureAction[],
  driver: ActionDriver,
  options: {
    signal?: AbortSignal;
    onAction?: (action: CaptureAction, index: number) => void;
  } = {},
): Promise<void> {
  for (const [index, action] of actions.entries()) {
    throwIfAborted(options.signal);
    options.onAction?.(action, index);
    try {
      switch (action.type) {
        case 'wait-for-selector':
          await driver.waitForSelector(action.selector, action.timeoutMs);
          break;
        case 'click':
          await driver.click(action.selector);
          break;
        case 'select-index':
          await driver.selectIndex(action.selector, action.index);
          break;
        case 'scroll-to':
          await driver.scrollTo(action.selector, action.topOffset);
          break;
        case 'wait-for-url':
          await driver.waitForUrl(action.pattern, action.timeoutMs);
          break;
        case 'delay':
          await driver.delay(action.milliseconds);
          break;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const selector = 'selector' in action ? ` Selector: ${action.selector}.` : '';
      throw new Error(`Action ${index + 1} (${action.type}) failed.${selector} ${detail}`, {
        cause: error,
      });
    }
  }
}

export function createCdpActionDriver(
  session: DebuggerSession,
  signal?: AbortSignal,
): ActionDriver {
  return {
    waitForSelector: (selector, timeoutMs) => waitForSelector(session, selector, timeoutMs, signal),
    async click(selector) {
      const result = await evaluate<{ ok: boolean; reason?: string }>(
        session,
        `(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!(element instanceof HTMLElement)) return { ok: false, reason: 'Element not found or not clickable' };
          element.focus();
          element.click();
          return { ok: true };
        })()`,
      );
      if (!result.ok) throw new Error(result.reason);
    },
    async selectIndex(selector, index) {
      const result = await evaluate<{ ok: boolean; reason?: string }>(
        session,
        `(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!(element instanceof HTMLSelectElement)) return { ok: false, reason: 'Select not found' };
          if (${index} < 0 || ${index} >= element.options.length) return { ok: false, reason: 'Option index is out of range' };
          element.selectedIndex = ${index};
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        })()`,
      );
      if (!result.ok) throw new Error(result.reason);
    },
    async scrollTo(selector, topOffset = 0) {
      const result = await evaluate<{ ok: boolean; reason?: string }>(
        session,
        `(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!(element instanceof HTMLElement)) return { ok: false, reason: 'Scroll target not found' };
          const top = element.getBoundingClientRect().top + window.scrollY - ${topOffset};
          window.scrollTo({ top, behavior: 'instant' });
          return { ok: true };
        })()`,
      );
      if (!result.ok) throw new Error(result.reason);
    },
    async waitForUrl(pattern, timeoutMs = 15_000) {
      const matcher = wildcardToRegExp(pattern);
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        throwIfAborted(signal);
        if (matcher.test(await evaluate<string>(session, 'location.href'))) return;
        await delay(100, signal);
      }
      throw new Error(`URL did not match "${pattern}" (${timeoutMs} ms).`);
    },
    delay: (milliseconds) => delay(milliseconds, signal),
  };
}

export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
