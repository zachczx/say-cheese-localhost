import manifest from './manifest.json';
import type { CaptureProfile } from '../schema';

/** Typed adapter for the hand-editable JSON manifest. */
export const cubbyProfileManifest: CaptureProfile = manifest;
export const cubbyPortfolioShots = cubbyProfileManifest.shots;
