import { describe, expect, it } from 'vitest';

import { besideController } from '../src/capture/placement';

const workArea = { left: 0, top: 0, width: 1920, height: 1032 };
const size = { width: 640, height: 1052 };

describe('capture window placement', () => {
  it('opens to the right of the controller when it fits', () => {
    expect(
      besideController({ left: 0, top: 0, width: 1200, height: 1032 }, size, workArea),
    ).toEqual({ left: 1200, top: 0, width: 640, height: 1032 });
  });

  it('falls back to the left side', () => {
    expect(
      besideController({ left: 900, top: 20, width: 1020, height: 900 }, size, workArea),
    ).toEqual({ left: 260, top: 0, width: 640, height: 1032 });
  });

  it('leaves placement to Chrome when neither side fits, but still clamps the size', () => {
    expect(
      besideController({ left: 100, top: 0, width: 1700, height: 1032 }, size, workArea),
    ).toEqual({ width: 640, height: 1032 });
    expect(besideController(undefined, size, { ...workArea, height: 600 })).toEqual({
      width: 640,
      height: 600,
    });
  });
});
