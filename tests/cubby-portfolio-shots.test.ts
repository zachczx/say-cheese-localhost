import { describe, expect, it } from 'vitest';
import { PROFILES } from '../src/profiles';
import { validateProfile } from '../src/profiles/schema';
import { VIEWPORTS } from '../src/profiles/viewports';

const cubbyShots = PROFILES.find((profile) => profile.id === 'cubby')!.shots;

// Screenshots the case study refresh uses, in chapter order. These start selected, so a
// default run covers the site. Every other shot is app coverage and starts cleared.
const caseStudyShots = [
  'dashboard',
  'dashboard-recent',
  'tasks',
  'limits',
  'screentimer',
  'enrichment',
  'gym-workout',
  'illness',
  'sleep',
  'coffee',
  'meals',
  'jobs',
  'expiry',
  'market',
  'finance',
  'growing-up',
  'journal-recap',
];

const appCoverageShots = [
  'gym-exercise',
  'moments',
  'schedule',
  'timeline',
  'calendar',
  'household',
  'track',
  'apps',
];

const shotOrder = [...caseStudyShots, ...appCoverageShots];

describe('Cubby shot curation', () => {
  it('registers Cubby as a selectable capture profile', () => {
    expect(PROFILES.map((profile) => profile.id)).toContain('cubby');
  });

  it('keeps a stable order and numbered file names', () => {
    expect(cubbyShots.map((shot) => shot.id)).toEqual(shotOrder);
    expect(cubbyShots.map((shot) => shot.filename)).toEqual(
      shotOrder.map((id, index) => `cubby-${String(index + 1).padStart(2, '0')}-${id}.webp`),
    );
  });

  it('selects exactly the case study screenshots by default', () => {
    expect(cubbyShots.filter((shot) => shot.enabledByDefault).map((shot) => shot.id)).toEqual(
      caseStudyShots,
    );
  });

  it('does not bring back retired shots or removed Cubby features', () => {
    const ids = cubbyShots.map((shot) => shot.id);
    for (const retired of ['market-scan', 'gym', 'coffee-brews', 'travel']) {
      expect(ids).not.toContain(retired);
    }
  });

  it('uses Workouts routes rather than the redirecting Gym ones', () => {
    expect(cubbyShots.filter((shot) => shot.path.startsWith('/app/gym'))).toEqual([]);
  });

  it('is valid profile data before Cubby activation', () => {
    expect(
      validateProfile(
        {
          id: 'cubby',
          label: 'Cubby',
          defaultBaseUrl: 'http://localhost:5173',
          outputDirectory: 'say-cheese-localhost/cubby',
          defaultViewport: 'phone',
          shots: cubbyShots,
        },
        VIEWPORTS,
      ),
    ).toEqual([]);
  });
});
