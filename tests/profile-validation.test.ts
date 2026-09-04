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

  it('rejects nested filenames and incomplete element captures', () => {
    const candidate = profile();
    candidate.shots[0]!.filename = 'nested\\home.webp';
    candidate.shots[0]!.capture = { mode: 'element' };
    expect(validateProfile(candidate, VIEWPORTS)).toEqual(
      expect.arrayContaining([
        'Shot "home" has an unsafe filename.',
        'Shot "home" uses element capture without a selector.',
      ]),
    );
  });
});

describe('viewport and route validation', () => {
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
