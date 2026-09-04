import { cubbyProfileManifest } from './cubby/shots';
import { demoProfile } from './demo/profile';
import type { CaptureProfile } from './schema';
import { validateProfile } from './schema';
import { VIEWPORTS } from './viewports';

const candidateProfiles: CaptureProfile[] = [demoProfile, cubbyProfileManifest];

export const PROFILES = candidateProfiles.map((profile) => {
  const errors = validateProfile(profile, VIEWPORTS);
  if (errors.length > 0) {
    throw new Error(`Invalid profile "${profile.id}":\n${errors.join('\n')}`);
  }
  return profile;
});
