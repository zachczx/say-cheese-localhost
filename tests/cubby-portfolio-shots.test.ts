import { describe, expect, it } from 'vitest';
import { PROFILES } from '../src/profiles';
import { validateProfile } from '../src/profiles/schema';
import { VIEWPORTS } from '../src/profiles/viewports';

const cubbyShots = PROFILES.find((profile) => profile.id === 'cubby')!.shots;

// Screenshots the public case study imports. These start selected, so a default run
// refreshes the site. Every other shot is app coverage and starts cleared.
const caseStudyShots = [
  'dashboard',
  'tasks',
  'limits',
  'screentimer',
  'enrichment',
  'gym-workout',
  'illness',
  'coffee',
  'meals',
  'expiry',
  'market',
  'finance',
  'travel',
  'growing-up',
  'journal-recap',
  'dashboard-recent',
];

const shotOrder = [
  'dashboard',
  'tasks',
  'limits',
  'screentimer',
  'enrichment',
  'gym-workout',
  'gym-exercise',
  'illness',
  'coffee',
  'meals',
  'expiry',
  'market',
  'finance',
  'travel',
  'growing-up',
  'journal-recap',
  'dashboard-recent',
  'sleep',
  'jobs',
  'moments',
  'schedule',
  'timeline',
  'calendar',
  'household',
  'track',
  'apps',
];

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
    expect(
      cubbyShots
        .filter((shot) => shot.enabledByDefault)
        .map((shot) => shot.id)
        .sort(),
    ).toEqual([...caseStudyShots].sort());
  });

  it('does not bring back retired shots', () => {
    const ids = cubbyShots.map((shot) => shot.id);
    for (const retired of ['market-scan', 'gym', 'coffee-brews']) {
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
