import { describe, expect, it } from 'vitest';

import { loadProfiles, PROFILES } from '../src/profiles';
import type { CaptureProfile } from '../src/profiles/schema';

function profile(id: string, label: string, order?: number): CaptureProfile {
  return {
    id,
    label,
    order,
    defaultBaseUrl: 'http://localhost:5173',
    outputDirectory: `say-cheese-localhost/${id}`,
    defaultViewport: 'phone',
    shots: [
      { id: 'home', label: 'Home', path: '/', filename: 'home.webp', enabledByDefault: true },
    ],
  };
}

describe('bundled profile loading', () => {
  it('discovers every manifest and keeps the local demo first', () => {
    expect(PROFILES.map((candidate) => candidate.id)).toEqual(['local-demo', 'cubby']);
  });

  it('orders by order, then label, with unordered profiles last', () => {
    const loaded = loadProfiles({
      './zeta/manifest.json': profile('zeta', 'Zeta'),
      './beta/manifest.json': profile('beta', 'Beta', 5),
      './alpha/manifest.json': profile('alpha', 'Alpha'),
      './first/manifest.json': profile('first', 'First', 1),
    });
    expect(loaded.map((candidate) => candidate.id)).toEqual(['first', 'beta', 'alpha', 'zeta']);
  });

  it('rejects duplicate IDs, invalid order, and invalid profiles with their source', () => {
    expect(() =>
      loadProfiles({
        './a/manifest.json': profile('same', 'A'),
        './b/manifest.json': profile('same', 'B', 1.5),
      }),
    ).toThrow(/\.\/b\/manifest\.json:[\s\S]*order must be an integer[\s\S]*also used by \.\/a/);
    expect(() =>
      loadProfiles({ './bad/manifest.json': { ...profile('bad', 'Bad'), shots: [] } }),
    ).toThrow(/\.\/bad\/manifest\.json:[\s\S]*has no shots/);
  });
});
