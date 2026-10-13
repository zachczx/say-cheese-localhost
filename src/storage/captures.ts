/** When each shot's image was last written to Downloads, kept across controller sessions. */
export interface CaptureRecord {
  savedAt: number;
  viewportId: string;
}

/** Records keyed by profile ID, then shot ID. */
export type CaptureLog = Record<string, Record<string, CaptureRecord>>;

const STORAGE_KEY = 'say-cheese-localhost.captures.v1';

export async function loadCaptureLog(): Promise<CaptureLog> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY];
  return stored && typeof stored === 'object' ? (stored as CaptureLog) : {};
}

export async function saveCaptureLog(log: CaptureLog): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: log });
}

const savedAtFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatSavedAt(savedAt: number): string {
  return savedAtFormat.format(new Date(savedAt));
}
