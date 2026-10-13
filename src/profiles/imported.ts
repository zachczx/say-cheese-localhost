import type { CaptureProfile } from './schema';
import { validateProfile } from './schema';
import { VIEWPORTS } from './viewports';

/**
 * Profiles imported from a JSON file at runtime, stored in extension storage.
 * They pass the same validation as bundled manifests. They cannot use request
 * replacements, because replacement images must be bundled with the extension.
 */
const STORAGE_KEY = 'say-cheese-localhost.imported-profiles.v1';
const MAX_IMPORT_BYTES = 256 * 1024;
const TOO_LARGE = 'The file is larger than 256 KB, which is too large for a profile.';

export type ProfileImportResult =
  { profile: CaptureProfile; replaced: boolean } | { errors: string[] };

export interface StoredImports {
  profiles: CaptureProfile[];
  /** Stored profiles that no longer pass validation or now share a built-in profile's ID. */
  dropped: number;
}

export function sortProfiles(profiles: readonly CaptureProfile[]): CaptureProfile[] {
  return [...profiles].sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      a.label.localeCompare(b.label, 'en-US'),
  );
}

export async function loadImportedProfiles(
  bundled: readonly CaptureProfile[],
): Promise<StoredImports> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored: unknown = result[STORAGE_KEY];
  if (!Array.isArray(stored)) return { profiles: [], dropped: 0 };
  // Re-validate on load: the schema may have tightened since the import, or a
  // later build may bundle a profile with the same ID.
  const taken = new Set(bundled.map((profile) => profile.id));
  const profiles: CaptureProfile[] = [];
  for (const candidate of stored) {
    if (checkProfile(candidate).length > 0) continue;
    const profile = candidate as CaptureProfile;
    if (taken.has(profile.id)) continue;
    taken.add(profile.id);
    profiles.push(profile);
  }
  return { profiles, dropped: stored.length - profiles.length };
}

export async function saveImportedProfiles(profiles: readonly CaptureProfile[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: profiles });
}

/** Reads a picked file, refusing oversized files before loading them into memory. */
export async function readProfileFile(
  file: Blob,
  bundled: readonly CaptureProfile[],
  imported: readonly CaptureProfile[],
): Promise<ProfileImportResult> {
  if (file.size > MAX_IMPORT_BYTES) return { errors: [TOO_LARGE] };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { errors: ['The file could not be read.'] };
  }
  return parseProfileImport(text, bundled, imported);
}

/** Parses and validates a manifest file's text against the profiles already available. */
export function parseProfileImport(
  text: string,
  bundled: readonly CaptureProfile[],
  imported: readonly CaptureProfile[],
): ProfileImportResult {
  if (text.length > MAX_IMPORT_BYTES) return { errors: [TOO_LARGE] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { errors: ['The file is not valid JSON.'] };
  }
  const errors = checkProfile(value);
  if (errors.length > 0) return { errors };
  const profile = value as CaptureProfile;
  if (bundled.some((candidate) => candidate.id === profile.id)) {
    return {
      errors: [`A built-in profile already uses the ID "${profile.id}". Choose another ID.`],
    };
  }
  return { profile, replaced: imported.some((candidate) => candidate.id === profile.id) };
}

function checkProfile(value: unknown): string[] {
  const errors = validateProfile(value as CaptureProfile, VIEWPORTS);
  const replacements = (value as { requestReplacements?: unknown } | null)?.requestReplacements;
  if (Array.isArray(replacements) && replacements.length > 0) {
    errors.push(
      'Imported profiles cannot use requestReplacements, because replacement images must be bundled.',
    );
  }
  // Several shots can fail the same way; list each problem once.
  return [...new Set(errors)];
}
