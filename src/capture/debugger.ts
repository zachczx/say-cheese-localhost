export interface DebuggerEvent {
  method: string;
  params: Record<string, unknown>;
}

export type DebuggerDetachReason = 'target_closed' | 'canceled_by_user';

export class DebuggerSession {
  readonly target: chrome.debugger.Debuggee;
  #attached = false;
  #listeners = new Set<(event: DebuggerEvent) => void>();
  #detachListeners = new Set<(reason: DebuggerDetachReason) => void>();

  constructor(tabId: number) {
    this.target = { tabId };
  }

  get attached(): boolean {
    return this.#attached;
  }

  async attach(): Promise<void> {
    await chrome.debugger.attach(this.target, '1.3');
    chrome.debugger.onEvent.addListener(this.#handleEvent);
    chrome.debugger.onDetach.addListener(this.#handleDetach);
    this.#attached = true;
  }

  async send<T>(method: string, commandParams: Record<string, unknown> = {}): Promise<T> {
    return (await chrome.debugger.sendCommand(this.target, method, commandParams)) as T;
  }

  onEvent(listener: (event: DebuggerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onDetach(listener: (reason: DebuggerDetachReason) => void): () => void {
    this.#detachListeners.add(listener);
    return () => this.#detachListeners.delete(listener);
  }

  async detach(): Promise<void> {
    if (!this.#attached) return;
    chrome.debugger.onEvent.removeListener(this.#handleEvent);
    chrome.debugger.onDetach.removeListener(this.#handleDetach);
    this.#listeners.clear();
    this.#detachListeners.clear();
    try {
      await chrome.debugger.detach(this.target);
    } finally {
      this.#attached = false;
    }
  }

  #handleEvent = (source: chrome.debugger.Debuggee, method: string, params?: object): void => {
    if (source.tabId !== this.target.tabId) return;
    const event = { method, params: (params ?? {}) as Record<string, unknown> };
    for (const listener of this.#listeners) listener(event);
  };

  #handleDetach = (source: chrome.debugger.Debuggee, reason: DebuggerDetachReason): void => {
    if (source.tabId !== this.target.tabId) return;
    this.#attached = false;
    chrome.debugger.onEvent.removeListener(this.#handleEvent);
    chrome.debugger.onDetach.removeListener(this.#handleDetach);
    this.#listeners.clear();
    for (const listener of this.#detachListeners) listener(reason);
    this.#detachListeners.clear();
  };
}
