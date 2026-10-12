import { describe, expect, it } from 'vitest';

import { PROFILES } from '../src/profiles';
import { VIEWPORTS } from '../src/profiles/viewports';
import { normalizePreferences } from '../src/storage/preferences';

describe('preference normalization', () => {
  it('fills defaults for a first run', () => {
    expect(normalizePreferences({}, PROFILES, VIEWPORTS)).toEqual({
      profileId: 'local-demo',
      viewportId: 'phone',
      baseUrls: {},
      selectedShots: {},
      continueOnError: true,
      retainWindowAfterFailure: false,
      captureBeyondViewport: false,
      fullPageCapture: false,
      manualPreparation: true,
      pageZoomPercent: 100,
      colorScheme: 'system',
      imageFormat: 'webp',
      separateRunFolders: false,
      extraViewportIds: [],
    });
  });

  it('keeps valid saved values', () => {
    const normalized = normalizePreferences(
      {
        profileId: 'cubby',
        viewportId: 'desktop',
        colorScheme: 'dark',
        imageFormat: 'png',
        pageZoomPercent: 220,
        extraViewportIds: ['tablet'],
        manualPreparation: false,
      },
      PROFILES,
      VIEWPORTS,
    );
    expect(normalized).toMatchObject({
      profileId: 'cubby',
      viewportId: 'desktop',
      colorScheme: 'dark',
      imageFormat: 'png',
      pageZoomPercent: 220,
      extraViewportIds: ['tablet'],
      manualPreparation: false,
    });
  });

  it('drops removed profiles, viewports, and unknown values', () => {
    const normalized = normalizePreferences(
      {
        profileId: 'retired',
        viewportId: 'watch',
        colorScheme: 'sepia' as never,
        imageFormat: 'gif' as never,
        pageZoomPercent: 9000,
        extraViewportIds: ['watch', 'laptop'],
      },
      PROFILES,
      VIEWPORTS,
    );
    expect(normalized).toMatchObject({
      profileId: 'local-demo',
      viewportId: 'phone',
      colorScheme: 'system',
      imageFormat: 'webp',
      pageZoomPercent: 100,
      extraViewportIds: ['laptop'],
    });
  });
});
