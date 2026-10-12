import { describe, expect, it } from 'vitest';

import { PROFILES } from '../src/profiles';
import { parseProfileImport, sortProfiles } from '../src/profiles/imported';
import type { CaptureProfile } from '../src/profiles/schema';

function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'lingo',
    label: 'Lingo',
    defaultBaseUrl: 'http://127.0.0.1:5180',
    outputDirectory: 'say-cheese-localhost/lingo',
    defaultViewport: 'phone',
    shots: [
      {
        id: 'home',
        label: 'Home',
        path: '/',
        filename: 'lingo-01-home.webp',
        enabledByDefault: true,
      },
    ],
    ...overrides,
  });
}

describe('profile import', () => {
  it('accepts a valid manifest and reports whether it replaces an earlier import', () => {
    const first = parseProfileImport(manifest(), PROFILES, []);
    expect(first).toMatchObject({ profile: { id: 'lingo' }, replaced: false });
    const again = parseProfileImport(manifest({ label: 'Lingo 2' }), PROFILES, [
      (first as { profile: CaptureProfile }).profile,
    ]);
    expect(again).toMatchObject({ profile: { label: 'Lingo 2' }, replaced: true });
  });

  it('rejects files that are not a profile', () => {
    expect(parseProfileImport('{', PROFILES, [])).toEqual({
      errors: ['The file is not valid JSON.'],
    });
    expect(parseProfileImport('[]', PROFILES, [])).toEqual({
      errors: ['The file must contain one profile object.'],
    });
    expect(parseProfileImport(manifest({ id: 7, shots: 'none' }), PROFILES, [])).toEqual({
      errors: ['The profile needs a "id" string.', 'The profile needs a "shots" list.'],
    });
    expect(parseProfileImport('x'.repeat(300 * 1024), PROFILES, [])).toEqual({
      errors: ['The file is larger than 256 KB, which is too large for a profile.'],
    });
  });

  it('applies the bundled schema rules and import-only restrictions', () => {
    const unsafe = parseProfileImport(
      manifest({
        outputDirectory: '../../Windows',
        requestReplacements: [{ urlPattern: '*', assetPaths: ['a.png'] }],
      }),
      PROFILES,
      [],
    );
    expect(unsafe).toEqual({
      errors: expect.arrayContaining([
        'Profile "lingo" has an unsafe output directory.',
        'Imported profiles cannot use requestReplacements, because replacement images must be bundled.',
      ]),
    });
    expect(parseProfileImport(manifest({ id: 'cubby' }), PROFILES, [])).toEqual({
      errors: ['A built-in profile already uses the ID "cubby". Choose another ID.'],
    });
  });

  it('sorts imported profiles after ordered bundled profiles', () => {
    const lingo = JSON.parse(manifest()) as CaptureProfile;
    expect(sortProfiles([lingo, ...PROFILES]).map((profile) => profile.id)).toEqual([
      'local-demo',
      'cubby',
      'lingo',
    ]);
  });
});
