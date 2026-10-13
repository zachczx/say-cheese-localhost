import type { ColorScheme } from '../capture/emulation';
import type { ImageFormat } from '../capture/screenshot';
import { normalizePageZoomPercent } from '../capture/zoom';
import type { CaptureProfile, ViewportPreset } from '../profiles/schema';

export interface Preferences {
  profileId: string;
  viewportId: string;
  baseUrls: Record<string, string>;
  selectedShots: Record<string, string[]>;
  continueOnError: boolean;
  retainWindowAfterFailure: boolean;
  captureBeyondViewport: boolean;
  fullPageCapture: boolean;
  manualPreparation: boolean;
  colorScheme: ColorScheme;
  imageFormat: ImageFormat;
  separateRunFolders: boolean;
  /** Viewports captured in addition to the main one, each into its own folder. */
  extraViewportIds: string[];
  pageZoomPercent: number;
}

const STORAGE_KEY = 'say-cheese-localhost.preferences.v1';

export async function loadPreferences(): Promise<Partial<Preferences>> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Partial<Preferences> | undefined) ?? {};
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: preferences });
}

/**
 * Fills in defaults and drops values that no longer apply, such as a removed
 * profile or viewport. Saved settings come from older versions too, so every
 * field is checked rather than trusted.
 */
export function normalizePreferences(
  stored: Partial<Preferences>,
  profiles: readonly CaptureProfile[],
  viewports: readonly ViewportPreset[],
): Preferences {
  const profile = profiles.find((candidate) => candidate.id === stored.profileId) ?? profiles[0];
  if (!profile) throw new Error('No capture profiles are available.');
  const knownViewport = (id: unknown) => viewports.some((candidate) => candidate.id === id);
  return {
    profileId: profile.id,
    viewportId: knownViewport(stored.viewportId)
      ? (stored.viewportId as string)
      : profile.defaultViewport,
    baseUrls: stored.baseUrls ?? {},
    selectedShots: stored.selectedShots ?? {},
    continueOnError: stored.continueOnError ?? true,
    retainWindowAfterFailure: stored.retainWindowAfterFailure ?? false,
    captureBeyondViewport: stored.captureBeyondViewport ?? false,
    fullPageCapture: stored.fullPageCapture ?? false,
    manualPreparation: stored.manualPreparation ?? true,
    pageZoomPercent: normalizePageZoomPercent(stored.pageZoomPercent),
    colorScheme:
      stored.colorScheme === 'light' || stored.colorScheme === 'dark'
        ? stored.colorScheme
        : 'system',
    imageFormat: stored.imageFormat === 'png' ? 'png' : 'webp',
    separateRunFolders: stored.separateRunFolders ?? false,
    extraViewportIds: Array.isArray(stored.extraViewportIds)
      ? stored.extraViewportIds.filter(knownViewport)
      : [],
  };
}
