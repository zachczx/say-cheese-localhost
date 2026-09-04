import { describe, expect, it } from 'vitest';
import { PROFILES } from '../src/profiles';
import { cubbyPortfolioShots } from '../src/profiles/cubby/shots';
import { validateProfile } from '../src/profiles/schema';
import { VIEWPORTS } from '../src/profiles/viewports';

const portfolioOrder = [
  'dashboard',
  'shelf',
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
];

describe('Cubby portfolio shot curation', () => {
  it('registers Cubby as a selectable capture profile', () => {
    expect(PROFILES.map((profile) => profile.id)).toContain('cubby');
  });

  it('matches the public case study exactly and in editorial order', () => {
    expect(cubbyPortfolioShots.map((shot) => shot.id)).toEqual(portfolioOrder);
    expect(cubbyPortfolioShots.map((shot) => shot.filename)).toEqual(
      portfolioOrder.map((id) => `${id}.webp`),
    );
  });

  it('does not retain screenshots absent from the public case study', () => {
    expect(cubbyPortfolioShots.map((shot) => shot.id)).not.toEqual(
      expect.arrayContaining(['market-scan', 'gym', 'coffee-brews', 'sleep', 'moments']),
    );
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
          shots: cubbyPortfolioShots,
        },
        VIEWPORTS,
      ),
    ).toEqual([]);
  });
});
