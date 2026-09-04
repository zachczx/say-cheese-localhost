import { describe, expect, it } from 'vitest';
import { joinDownloadPath } from '../src/profiles/schema';

describe('joinDownloadPath', () => {
  it('constructs a Downloads-relative screenshot path', () => {
    expect(joinDownloadPath('say-cheese-localhost/demo', 'overview.webp')).toBe(
      'say-cheese-localhost/demo/overview.webp',
    );
  });

  it.each(['/absolute', '\\server\\share', 'C:\\captures', '../outside'])(
    'rejects unsafe segment %s before normalization',
    (segment) => {
      expect(() => joinDownloadPath(segment, 'shot.webp')).toThrow(
        'Download path must stay beneath the Downloads directory.',
      );
    },
  );
});
