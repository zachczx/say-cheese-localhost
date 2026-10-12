/**
 * Capture windows outlive their controller if the controller tab closes mid-run:
 * the debugger stays attached and the window keeps its emulation. The job records
 * its window in session storage so the background worker, or the next controller,
 * can detach and close it.
 */
export interface CaptureWindowRecord {
  windowId: number;
  tabId: number;
  /** Tab of the controller that owns the job. */
  ownerTabId?: number;
}

const STORAGE_KEY = 'say-cheese-localhost.capture-windows.v1';

async function readRecords(): Promise<CaptureWindowRecord[]> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  const records = result[STORAGE_KEY];
  return Array.isArray(records) ? (records as CaptureWindowRecord[]) : [];
}

async function writeRecords(records: CaptureWindowRecord[]): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: records });
}

export async function rememberCaptureWindow(record: CaptureWindowRecord): Promise<void> {
  const records = await readRecords();
  await writeRecords([...records.filter((item) => item.windowId !== record.windowId), record]);
}

export async function forgetCaptureWindow(windowId: number): Promise<void> {
  const records = await readRecords();
  await writeRecords(records.filter((item) => item.windowId !== windowId));
}

async function closeRecord(record: CaptureWindowRecord): Promise<void> {
  await chrome.debugger.detach({ tabId: record.tabId }).catch(() => undefined);
  await chrome.windows.remove(record.windowId).catch(() => undefined);
}

/** Called by the background worker when a controller tab closes. */
export async function closeWindowsOwnedBy(ownerTabId: number): Promise<number> {
  const records = await readRecords();
  const owned = records.filter((record) => record.ownerTabId === ownerTabId);
  for (const record of owned) await closeRecord(record);
  if (owned.length > 0) {
    await writeRecords(records.filter((record) => record.ownerTabId !== ownerTabId));
  }
  return owned.length;
}

/**
 * Called when a controller starts. Closes recorded windows whose owner is gone,
 * leaving windows that belong to another open controller alone.
 */
export async function closeOrphanedCaptureWindows(currentTabId?: number): Promise<number> {
  const records = await readRecords();
  const kept: CaptureWindowRecord[] = [];
  let closed = 0;
  for (const record of records) {
    const ownerAlive =
      record.ownerTabId !== undefined &&
      record.ownerTabId !== currentTabId &&
      (await chrome.tabs.get(record.ownerTabId).then(
        () => true,
        () => false,
      ));
    if (ownerAlive) {
      kept.push(record);
      continue;
    }
    await closeRecord(record);
    closed += 1;
  }
  if (closed > 0) await writeRecords(kept);
  return closed;
}
