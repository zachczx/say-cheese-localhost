import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeOrphanedCaptureWindows,
  closeWindowsOwnedBy,
  forgetCaptureWindow,
  rememberCaptureWindow,
  type CaptureWindowRecord,
} from '../src/capture/orphans';

let session: Record<string, unknown>;
const detach = vi.fn<(target: { tabId: number }) => Promise<void>>(async () => undefined);
const remove = vi.fn<(windowId: number) => Promise<void>>(async () => undefined);
const openTabs = new Set<number>();
const openWindows = new Set<number>();
let tabLookup: (tabId: number) => Promise<{ id: number }>;

function records(): CaptureWindowRecord[] {
  return Object.entries(session)
    .filter(([key]) => key.startsWith('say-cheese-localhost.capture-window.v2.'))
    .map(([, record]) => record as CaptureWindowRecord)
    .sort((a, b) => a.windowId - b.windowId);
}

beforeEach(() => {
  session = { unrelated: 'kept' };
  detach.mockClear();
  remove.mockClear();
  openTabs.clear();
  openWindows.clear();
  tabLookup = async (tabId) => {
    if (!openTabs.has(tabId)) throw new Error(`No tab with id: ${tabId}.`);
    return { id: tabId };
  };
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: async (key: string | null) =>
          key === null ? { ...session } : { [key]: session[key] },
        set: async (items: Record<string, unknown>) => void Object.assign(session, items),
        remove: async (key: string) => void delete session[key],
      },
    },
    debugger: { detach },
    windows: {
      remove,
      get: async (windowId: number) => {
        if (!openWindows.has(windowId)) throw new Error(`No window with id: ${windowId}.`);
        return { id: windowId };
      },
    },
    tabs: { get: (tabId: number) => tabLookup(tabId) },
  });
});

describe('capture window cleanup', () => {
  it('remembers and forgets capture windows', async () => {
    await rememberCaptureWindow({ windowId: 1, tabId: 11, ownerTabId: 100 });
    await rememberCaptureWindow({ windowId: 2, tabId: 22, ownerTabId: 200 });
    await forgetCaptureWindow(1);
    expect(records()).toEqual([{ windowId: 2, tabId: 22, ownerTabId: 200 }]);
    expect(session.unrelated).toBe('kept');
  });

  it('closes only the windows owned by a closed controller', async () => {
    await rememberCaptureWindow({ windowId: 1, tabId: 11, ownerTabId: 100 });
    await rememberCaptureWindow({ windowId: 2, tabId: 22, ownerTabId: 200 });
    await expect(closeWindowsOwnedBy(100)).resolves.toBe(1);
    expect(detach).toHaveBeenCalledWith({ tabId: 11 });
    expect(remove).toHaveBeenCalledWith(1);
    expect(remove).not.toHaveBeenCalledWith(2);
    expect(records()).toEqual([{ windowId: 2, tabId: 22, ownerTabId: 200 }]);
  });

  it('closes orphans on startup but keeps windows of another open controller', async () => {
    openTabs.add(200);
    await rememberCaptureWindow({ windowId: 1, tabId: 11, ownerTabId: 100 });
    await rememberCaptureWindow({ windowId: 2, tabId: 22, ownerTabId: 200 });
    await expect(closeOrphanedCaptureWindows(300)).resolves.toBe(1);
    expect(remove.mock.calls.map(([id]) => id)).toEqual([1]);
    expect(records()).toEqual([{ windowId: 2, tabId: 22, ownerTabId: 200 }]);
  });

  it('treats a record owned by the starting controller itself as orphaned', async () => {
    openTabs.add(100);
    await rememberCaptureWindow({ windowId: 1, tabId: 11, ownerTabId: 100 });
    await expect(closeOrphanedCaptureWindows(100)).resolves.toBe(1);
  });

  it('leaves windows with an unknown owner open and drops their record once closed', async () => {
    openWindows.add(3);
    await rememberCaptureWindow({ windowId: 3, tabId: 33 });
    await rememberCaptureWindow({ windowId: 4, tabId: 44 });
    await expect(closeOrphanedCaptureWindows(300)).resolves.toBe(0);
    expect(remove).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();
    expect(records()).toEqual([{ windowId: 3, tabId: 33 }]);
  });

  it('keeps a window recorded by another controller while startup cleanup runs', async () => {
    await rememberCaptureWindow({ windowId: 1, tabId: 11, ownerTabId: 100 });
    let releaseLookup!: () => void;
    tabLookup = () =>
      new Promise((_, reject) => {
        releaseLookup = () => reject(new Error('No tab with id: 100.'));
      });
    const cleanup = closeOrphanedCaptureWindows(300);
    await vi.waitFor(() => expect(releaseLookup).toBeDefined());
    await rememberCaptureWindow({ windowId: 2, tabId: 22, ownerTabId: 200 });
    releaseLookup();
    await expect(cleanup).resolves.toBe(1);
    expect(records()).toEqual([{ windowId: 2, tabId: 22, ownerTabId: 200 }]);
  });
});
