export interface Preferences {
  profileId: string;
  viewportId: string;
  baseUrls: Record<string, string>;
  selectedShots: Record<string, string[]>;
  continueOnError: boolean;
  retainWindowAfterFailure: boolean;
}

const STORAGE_KEY = 'say-cheese-localhost.preferences.v1';

export async function loadPreferences(): Promise<Partial<Preferences>> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Partial<Preferences> | undefined) ?? {};
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: preferences });
}
