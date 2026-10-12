import { describe, expect, it } from 'vitest';
import {
  isOriginRelativePath,
  validateProfile,
  validateViewport,
  type CaptureProfile,
} from '../src/profiles/schema';
import { VIEWPORTS } from '../src/profiles/viewports';

function profile(overrides: Partial<CaptureProfile> = {}): CaptureProfile {
  return {
    id: 'demo',
    label: 'Demo',
    defaultBaseUrl: 'http://localhost:5173',
    outputDirectory: 'say-cheese-localhost/demo',
    defaultViewport: 'phone',
    shots: [
      {
        id: 'home',
        label: 'Home',
        path: '/',
        filename: 'home.webp',
        enabledByDefault: true,
      },
    ],
    ...overrides,
  };
}

describe('validateProfile', () => {
  it('accepts the bundled profile shape', () => {
    expect(validateProfile(profile(), VIEWPORTS)).toEqual([]);
  });

  it('detects case-insensitive duplicate IDs and filenames', () => {
    const candidate = profile();
    candidate.shots.push({
      ...candidate.shots[0]!,
      id: 'HOME',
      filename: 'HOME.WEBP',
    });
    expect(validateProfile(candidate, VIEWPORTS)).toEqual(
      expect.arrayContaining(['Duplicate shot ID "HOME".', 'Duplicate filename "HOME.WEBP".']),
    );
  });

  it('rejects unknown viewports, absolute output paths, and cross-origin routes', () => {
    const candidate = profile({ defaultViewport: 'cinema', outputDirectory: 'C:\\captures' });
    candidate.shots[0]!.path = '//example.com/private';
    expect(validateProfile(candidate, VIEWPORTS)).toEqual(
      expect.arrayContaining([
        'Profile "demo" has an unsafe output directory.',
        'Profile "demo" references unknown viewport "cinema".',
        'Shot "home" must use a same-origin absolute path.',
      ]),
    );
  });

  it('rejects nested filenames, invalid captureBeyondViewport, and incomplete element captures', () => {
    const candidate = profile();
    candidate.shots[0]!.filename = 'nested\\home.webp';
    candidate.shots[0]!.capture = {
      mode: 'element',
      captureBeyondViewport: 'yes' as unknown as boolean,
    };
    expect(validateProfile(candidate, VIEWPORTS)).toEqual(
      expect.arrayContaining([
        'Shot "home" has an unsafe filename.',
        'Shot "home" uses element capture without a selector.',
        'Shot "home" captureBeyondViewport must be a boolean.',
      ]),
    );
  });

  it('accepts IANA timezones and rejects unknown ones', () => {
    expect(validateProfile(profile({ timezone: 'America/New_York' }), VIEWPORTS)).toEqual([]);
    expect(validateProfile(profile({ timezone: 'Nowhere/City' }), VIEWPORTS)).toEqual([
      'Profile "demo" has an unknown timezone "Nowhere/City".',
    ]);
  });

  it('validates the optional base URL hint', () => {
    expect(validateProfile(profile({ baseUrlHint: 'Start the QA server.' }), VIEWPORTS)).toEqual(
      [],
    );
    for (const baseUrlHint of ['  ', 'x'.repeat(161)]) {
      expect(validateProfile(profile({ baseUrlHint }), VIEWPORTS)).toEqual([
        'Profile "demo" baseUrlHint must be 1–160 characters.',
      ]);
    }
  });

  it('accepts tuned timeouts and rejects unknown, out-of-range, or inconsistent ones', () => {
    expect(
      validateProfile(profile({ timeouts: { shotMs: 90_000, assetsMs: 30_000 } }), VIEWPORTS),
    ).toEqual([]);
    const invalid = profile({
      timeouts: { shotMs: 500, navigationMs: 1.5, typo: 1 } as never,
    });
    expect(validateProfile(invalid, VIEWPORTS)).toEqual(
      expect.arrayContaining([
        'Profile "demo" timeout "shotMs" must be 1000–600000 ms.',
        'Profile "demo" timeout "navigationMs" must be 1000–600000 ms.',
        'Profile "demo" has unknown timeout "typo".',
      ]),
    );
    expect(
      validateProfile(profile({ timeouts: { shotMs: 20_000, navigationMs: 30_000 } }), VIEWPORTS),
    ).toEqual(['Profile "demo" timeout "navigationMs" exceeds "shotMs".']);
  });
});

describe('viewport and route validation', () => {
  it('uses iPhone 14 Pro Max as the default phone size', () => {
    expect(VIEWPORTS.find((viewport) => viewport.id === 'phone')).toMatchObject({
      width: 430,
      height: 932,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
    });
  });

  it('keeps every viewport preset ID unique and valid', () => {
    expect(new Set(VIEWPORTS.map((viewport) => viewport.id)).size).toBe(VIEWPORTS.length);
    expect(VIEWPORTS.flatMap(validateViewport)).toEqual([]);
  });

  it('rejects invalid viewport dimensions and DPR', () => {
    expect(
      validateViewport({
        id: 'bad',
        label: 'Bad',
        width: 10,
        height: 0,
        deviceScaleFactor: 8,
        mobile: false,
        touch: false,
      }),
    ).toHaveLength(3);
  });

  it('allows same-origin paths with queries and rejects protocol-relative URLs', () => {
    expect(isOriginRelativePath('/fixture/?state=details')).toBe(true);
    expect(isOriginRelativePath('//example.com')).toBe(false);
    expect(isOriginRelativePath('/\\example.com')).toBe(false);
  });
});
