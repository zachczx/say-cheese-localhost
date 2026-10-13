import { describe, expect, it, vi } from 'vitest';

import { PROFILES } from '../src/profiles';
import {
  loadImportedProfiles,
  parseProfileImport,
  readProfileFile,
  sortProfiles,
} from '../src/profiles/imported';
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
      errors: ['The profile must be a JSON object.'],
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

  it('reports malformed nested fields instead of throwing', () => {
    const shot = { id: 'home', label: 'Home', path: '/', filename: 'home.webp' };
    expect(
      parseProfileImport(
        manifest({ shots: [{ ...shot, enabledByDefault: true, actions: [null] }] }),
        PROFILES,
        [],
      ),
    ).toEqual({ errors: ['Shot "home" action 1 uses an unsupported type.'] });
  });

  it('lists a repeated problem once', () => {
    const blank = { id: '', label: 'Blank', path: '/', enabledByDefault: true };
    const result = parseProfileImport(
      manifest({
        shots: [
          { ...blank, filename: 'a.webp' },
          { ...blank, filename: 'b.webp' },
        ],
      }),
      PROFILES,
      [],
    );
    const errors = (result as { errors: string[] }).errors;
    expect(errors.filter((error) => error === 'Shot ID is required.')).toHaveLength(1);
    expect(new Set(errors).size).toBe(errors.length);
  });

  it('refuses oversized files before reading them and reports unreadable ones', async () => {
    const text = vi.fn(async () => '{}');
    const huge = { size: 300 * 1024, text } as unknown as Blob;
    await expect(readProfileFile(huge, PROFILES, [])).resolves.toEqual({
      errors: ['The file is larger than 256 KB, which is too large for a profile.'],
    });
    expect(text).not.toHaveBeenCalled();

    const unreadable = {
      size: 10,
      text: async () => {
        throw new Error('NotReadableError');
      },
    } as unknown as Blob;
    await expect(readProfileFile(unreadable, PROFILES, [])).resolves.toEqual({
      errors: ['The file could not be read.'],
    });
  });

  it('drops stored profiles that are invalid or now share a built-in ID', async () => {
    const lingo = JSON.parse(manifest()) as CaptureProfile;
    const stored = [lingo, { id: 'broken' }, { ...lingo, id: 'cubby' }, { ...lingo }];
    vi.stubGlobal('chrome', {
      storage: { local: { get: async (key: string) => ({ [key]: stored }) } },
    });
    await expect(loadImportedProfiles(PROFILES)).resolves.toEqual({
      profiles: [lingo],
      dropped: 3,
    });
    vi.unstubAllGlobals();
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
