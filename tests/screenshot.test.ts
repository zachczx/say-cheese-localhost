import { describe, expect, it, vi } from 'vitest';
import type { DebuggerSession } from '../src/capture/debugger';
import { captureShot } from '../src/capture/screenshot';
import type { Shot } from '../src/profiles/schema';

const shot: Shot = {
  id: 'manual',
  label: 'Manual',
  path: '/',
  filename: 'manual.webp',
  enabledByDefault: true,
};
const clip = { x: 12, y: 640, width: 390, height: 844, scale: 1 };

describe('viewport capture', () => {
  it.each([false, true])('restores prepared scroll after capture (failure=%s)', async (fails) => {
    const send = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'Page.captureScreenshot') {
        if (fails) throw new Error('Screenshot failed');
        return { data: 'image-data' };
      }
      if (String(params.expression).startsWith('window.scrollTo')) return { result: {} };
      return { result: { value: clip } };
    });
    const operation = captureShot({ send } as unknown as DebuggerSession, shot);
    if (fails) await expect(operation).rejects.toThrow('Screenshot failed');
    else await expect(operation).resolves.toBe('data:image/webp;base64,image-data');

    expect(send).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.objectContaining({
        clip,
        captureBeyondViewport: true,
      }),
    );
    expect(send).toHaveBeenLastCalledWith(
      'Runtime.evaluate',
      expect.objectContaining({
        expression: 'window.scrollTo(12, 640)',
      }),
    );
  });
});
