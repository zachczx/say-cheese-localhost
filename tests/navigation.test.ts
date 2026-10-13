import { describe, expect, it } from 'vitest';

import type { DebuggerEvent, DebuggerSession } from '../src/capture/debugger';
import { navigateAndWait } from '../src/capture/navigation';

function fakeSession(
  events: DebuggerEvent[],
  result: { loaderId?: string; errorText?: string },
): DebuggerSession {
  const listeners = new Set<(event: DebuggerEvent) => void>();
  return {
    onEvent(listener: (event: DebuggerEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send(method: string) {
      if (method !== 'Page.navigate') throw new Error(`Unexpected ${method}`);
      for (const event of events) for (const listener of listeners) listener(event);
      setTimeout(() => {
        for (const listener of listeners) listener({ method: 'Page.loadEventFired', params: {} });
      }, 0);
      return result;
    },
  } as unknown as DebuggerSession;
}

function documentResponse(loaderId: string, url: string, status: number): DebuggerEvent {
  return {
    method: 'Network.responseReceived',
    params: { type: 'Document', loaderId, response: { url, status } },
  };
}

describe('navigateAndWait', () => {
  it('reports the final status after a redirect changes the URL', async () => {
    const session = fakeSession(
      [
        documentResponse('main', 'http://localhost:5173/app/', 503),
        documentResponse('iframe', 'http://localhost:5173/embed', 200),
      ],
      { loaderId: 'main' },
    );
    await expect(navigateAndWait(session, 'http://localhost:5173/app')).resolves.toEqual({
      status: 503,
    });
  });

  it('falls back to the requested URL when Chrome returns no loader', async () => {
    const session = fakeSession([documentResponse('x', 'http://localhost:5173/', 404)], {});
    await expect(navigateAndWait(session, 'http://localhost:5173/')).resolves.toEqual({
      status: 404,
    });
  });

  it('surfaces navigation errors', async () => {
    const session = fakeSession([], { errorText: 'net::ERR_CONNECTION_REFUSED' });
    await expect(navigateAndWait(session, 'http://localhost:5173/')).rejects.toThrow(
      'net::ERR_CONNECTION_REFUSED',
    );
  });
});
