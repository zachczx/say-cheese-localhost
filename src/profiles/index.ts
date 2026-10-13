import type { CaptureProfile } from './schema';
import { validateProfile } from './schema';
import { VIEWPORTS } from './viewports';

/**
 * Every `src/profiles/<folder>/manifest.json` is bundled. Add a folder with a
 * manifest and rebuild to register a profile; no code changes are needed.
 */
const manifests = import.meta.glob<CaptureProfile>('./*/manifest.json', {
  eager: true,
  import: 'default',
});

/** Validates manifests and orders them by `order`, then label. Throws on any invalid profile. */
export function loadProfiles(sources: Record<string, CaptureProfile>): CaptureProfile[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  const profiles = Object.entries(sources).map(([source, profile]) => {
    const problems = validateProfile(profile, VIEWPORTS);
    const duplicate = seen.get(profile.id);
    if (duplicate) problems.push(`Profile ID "${profile.id}" is also used by ${duplicate}.`);
    seen.set(profile.id, source);
    if (problems.length > 0) errors.push(`${source}:\n${problems.join('\n')}`);
    return profile;
  });
  if (errors.length > 0) throw new Error(`Invalid capture profiles:\n${errors.join('\n')}`);
  return profiles.sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      a.label.localeCompare(b.label, 'en-US'),
  );
}

export const PROFILES = loadProfiles(manifests);
