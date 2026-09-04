import { describe, expect, it } from 'vitest';
import { deterministicAsset, matchesUrlPattern } from '../src/capture/requests';

describe('request replacement', () => {
  it('matches CDP-style wildcard URL patterns', () => {
    expect(
      matchesUrlPattern(
        'https://family.r2.cloudflarestorage.com/photo/private.webp',
        'https://*.r2.cloudflarestorage.com/**',
      ),
    ).toBe(true);
    expect(
      matchesUrlPattern('https://example.com/photo.webp', 'https://*.r2.cloudflarestorage.com/**'),
    ).toBe(false);
  });

  it('selects the same bundled asset for the same request', () => {
    const assets = ['profiles/demo/a.webp', 'profiles/demo/b.webp', 'profiles/demo/c.webp'];
    const url = 'https://images.example.test/private/123.webp';
    expect(deterministicAsset(url, assets)).toBe(deterministicAsset(url, assets));
    expect(assets).toContain(deterministicAsset(url, assets));
  });

  it('refuses an empty replacement pool', () => {
    expect(() => deterministicAsset('https://example.test/photo.webp', [])).toThrow(
      'Replacement requires at least one asset.',
    );
  });
});
