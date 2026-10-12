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

export type ProfileImportResult =
  { profile: CaptureProfile; replaced: boolean } | { errors: string[] };

export function sortProfiles(profiles: readonly CaptureProfile[]): CaptureProfile[] {
  return [...profiles].sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      a.label.localeCompare(b.label, 'en-US'),
  );
}

export async function loadImportedProfiles(): Promise<CaptureProfile[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY];
  if (!Array.isArray(stored)) return [];
  // Re-validate on load: the schema may have tightened since the import.
  return stored.filter(
    (candidate): candidate is CaptureProfile => checkProfile(candidate).length === 0,
  );
}

export async function saveImportedProfiles(profiles: readonly CaptureProfile[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: profiles });
}

/** Parses and validates a manifest file's text against the profiles already available. */
export function parseProfileImport(
  text: string,
  bundled: readonly CaptureProfile[],
  imported: readonly CaptureProfile[],
): ProfileImportResult {
  if (text.length > MAX_IMPORT_BYTES) {
    return { errors: ['The file is larger than 256 KB, which is too large for a profile.'] };
  }
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
  const shapeErrors = checkShape(value);
  if (shapeErrors.length > 0) return shapeErrors;
  const profile = value as CaptureProfile;
  const errors = validateProfile(profile, VIEWPORTS);
  if (profile.requestReplacements?.length) {
    errors.push(
      'Imported profiles cannot use requestReplacements, because replacement images must be bundled.',
    );
  }
  return errors;
}

/** Guards the structure validateProfile relies on, since imported JSON is untrusted. */
function checkShape(value: unknown): string[] {
  if (!isRecord(value)) return ['The file must contain one profile object.'];
  const errors: string[] = [];
  for (const key of ['id', 'label', 'defaultBaseUrl', 'outputDirectory', 'defaultViewport']) {
    if (typeof value[key] !== 'string') errors.push(`The profile needs a "${key}" string.`);
  }
  if (!Array.isArray(value.shots)) {
    errors.push('The profile needs a "shots" list.');
    return errors;
  }
  value.shots.forEach((shot, index) => {
    if (!isRecord(shot)) {
      errors.push(`Shot ${index + 1} must be an object.`);
      return;
    }
    for (const key of ['id', 'label', 'path', 'filename']) {
      if (typeof shot[key] !== 'string') {
        errors.push(`Shot ${index + 1} needs a "${key}" string.`);
      }
    }
    if (typeof shot.enabledByDefault !== 'boolean') {
      errors.push(`Shot ${index + 1} needs "enabledByDefault" set to true or false.`);
    }
    for (const key of ['ready', 'actions']) {
      if (shot[key] !== undefined && !Array.isArray(shot[key])) {
        errors.push(`Shot ${index + 1} "${key}" must be a list.`);
      }
    }
  });
  if (value.requestReplacements !== undefined && !Array.isArray(value.requestReplacements)) {
    errors.push('"requestReplacements" must be a list.');
  }
  if (value.timeouts !== undefined && !isRecord(value.timeouts)) {
    errors.push('"timeouts" must be an object.');
  }
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
