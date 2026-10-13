/**
 * Capture windows outlive their controller if the controller tab closes mid-run:
 * the debugger stays attached and the window keeps its emulation. The job records
 * its window in session storage so the background worker, or the next controller,
 * can detach and close it.
 *
 * Each window has its own storage key. The background worker and every open
 * controller write these records, and a shared list would let one writer's
 * read-modify-write drop another's record.
 */
export interface CaptureWindowRecord {
  windowId: number;
  tabId: number;
  /** Tab of the controller that owns the job. */
  ownerTabId?: number;
}

const KEY_PREFIX = 'say-cheese-localhost.capture-window.v2.';

function keyFor(windowId: number): string {
  return `${KEY_PREFIX}${windowId}`;
}

async function readRecords(): Promise<CaptureWindowRecord[]> {
  const items = await chrome.storage.session.get(null);
  return Object.entries(items)
    .filter(([key]) => key.startsWith(KEY_PREFIX))
    .map(([, record]) => record as CaptureWindowRecord);
}

export async function rememberCaptureWindow(record: CaptureWindowRecord): Promise<void> {
  await chrome.storage.session.set({ [keyFor(record.windowId)]: record });
}

export async function forgetCaptureWindow(windowId: number): Promise<void> {
  await chrome.storage.session.remove(keyFor(windowId));
}

async function closeRecord(record: CaptureWindowRecord): Promise<void> {
  await chrome.debugger.detach({ tabId: record.tabId }).catch(() => undefined);
  await chrome.windows.remove(record.windowId).catch(() => undefined);
  await forgetCaptureWindow(record.windowId);
}

/** Called by the background worker when a controller tab closes. */
export async function closeWindowsOwnedBy(ownerTabId: number): Promise<number> {
  const owned = (await readRecords()).filter((record) => record.ownerTabId === ownerTabId);
  for (const record of owned) await closeRecord(record);
  return owned.length;
}

/**
 * Called when a controller starts. Closes recorded windows whose owner is gone,
 * leaving windows that belong to another open controller alone.
 */
export async function closeOrphanedCaptureWindows(currentTabId?: number): Promise<number> {
  let closed = 0;
  for (const record of await readRecords()) {
    if (record.ownerTabId === undefined) {
      // The owner is unknown, so its job may still be running. Only drop the
      // record once its window is gone.
      const windowOpen = await chrome.windows.get(record.windowId).then(
        () => true,
        () => false,
      );
      if (!windowOpen) await forgetCaptureWindow(record.windowId);
      continue;
    }
    const ownerAlive =
      record.ownerTabId !== currentTabId &&
      (await chrome.tabs.get(record.ownerTabId).then(
        () => true,
        () => false,
      ));
    if (ownerAlive) continue;
    await closeRecord(record);
    closed += 1;
  }
  return closed;
}
