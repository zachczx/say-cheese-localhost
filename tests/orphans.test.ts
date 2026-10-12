import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeOrphanedCaptureWindows,
  closeWindowsOwnedBy,
  forgetCaptureWindow,
  rememberCaptureWindow,
} from '../src/capture/orphans';

const KEY = 'say-cheese-localhost.capture-windows.v1';
let session: Record<string, unknown>;
const detach = vi.fn<(target: { tabId: number }) => Promise<void>>(async () => undefined);
const remove = vi.fn<(windowId: number) => Promise<void>>(async () => undefined);
const openTabs = new Set<number>();

beforeEach(() => {
  session = {};
  detach.mockClear();
  remove.mockClear();
  openTabs.clear();
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: session[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(session, items),
      },
    },
    debugger: { detach },
    windows: { remove },
    tabs: {
      get: async (tabId: number) => {
        if (!openTabs.has(tabId)) throw new Error(`No tab with id: ${tabId}.`);
        return { id: tabId };
      },
    },
  });
});

describe('capture window cleanup', () => {
  it('remembers and forgets capture windows', async () => {
    await rememberCaptureWindow({ windowId: 1, tabId: 11, ownerTabId: 100 });
    await rememberCaptureWindow({ windowId: 2, tabId: 22, ownerTabId: 200 });
    await forgetCaptureWindow(1);
    expect(session[KEY]).toEqual([{ windowId: 2, tabId: 22, ownerTabId: 200 }]);
  });

  it('closes only the windows owned by a closed controller', async () => {
    await rememberCaptureWindow({ windowId: 1, tabId: 11, ownerTabId: 100 });
    await rememberCaptureWindow({ windowId: 2, tabId: 22, ownerTabId: 200 });
    await expect(closeWindowsOwnedBy(100)).resolves.toBe(1);
    expect(detach).toHaveBeenCalledWith({ tabId: 11 });
    expect(remove).toHaveBeenCalledWith(1);
    expect(remove).not.toHaveBeenCalledWith(2);
    expect(session[KEY]).toEqual([{ windowId: 2, tabId: 22, ownerTabId: 200 }]);
  });

  it('closes orphans on startup but keeps windows of another open controller', async () => {
    openTabs.add(200);
    await rememberCaptureWindow({ windowId: 1, tabId: 11, ownerTabId: 100 });
    await rememberCaptureWindow({ windowId: 2, tabId: 22, ownerTabId: 200 });
    await rememberCaptureWindow({ windowId: 3, tabId: 33 });
    await expect(closeOrphanedCaptureWindows(300)).resolves.toBe(2);
    expect(remove.mock.calls.map(([id]) => id)).toEqual([1, 3]);
    expect(session[KEY]).toEqual([{ windowId: 2, tabId: 22, ownerTabId: 200 }]);
  });

  it('treats a record owned by the starting controller itself as orphaned', async () => {
    openTabs.add(100);
    await rememberCaptureWindow({ windowId: 1, tabId: 11, ownerTabId: 100 });
    await expect(closeOrphanedCaptureWindows(100)).resolves.toBe(1);
  });
});
