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
const scroll = { x: 12, y: 640 };

describe('captureShot', () => {
  describe('viewport mode', () => {
    it.each([false, true])('restores prepared scroll after capture (failure=%s)', async (fails) => {
      const send = vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'Page.captureScreenshot') {
          if (fails) throw new Error('Screenshot failed');
          return { data: 'image-data' };
        }
        if (String(params.expression).startsWith('window.scrollTo')) return { result: {} };
        return { result: { value: scroll } };
      });
      const operation = captureShot({ send } as unknown as DebuggerSession, shot);
      if (fails) await expect(operation).rejects.toThrow('Screenshot failed');
      else await expect(operation).resolves.toBe('data:image/webp;base64,image-data');

      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'webp',
        quality: 100,
        fromSurface: true,
        captureBeyondViewport: false,
      });
      expect(send).toHaveBeenLastCalledWith(
        'Runtime.evaluate',
        expect.objectContaining({
          expression: 'window.scrollTo(12, 640)',
        }),
      );
    });

    it('enables captureBeyondViewport with clip when selected in options', async () => {
      const clip = { x: 12, y: 640, width: 390, height: 844, scale: 1 };
      const send = vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'Page.captureScreenshot') return { data: 'image-data' };
        if (String(params.expression).startsWith('window.scrollTo')) return { result: {} };
        return { result: { value: clip } };
      });
      const result = await captureShot({ send } as unknown as DebuggerSession, shot, {
        captureBeyondViewport: true,
      });
      expect(result).toBe('data:image/webp;base64,image-data');
      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'webp',
        quality: 100,
        fromSurface: true,
        captureBeyondViewport: true,
        clip,
      });
      expect(send).toHaveBeenLastCalledWith(
        'Runtime.evaluate',
        expect.objectContaining({
          expression: 'window.scrollTo(12, 640)',
        }),
      );
    });
  });

  describe('full-page mode', () => {
    it('defaults captureBeyondViewport to false unless selected in options', async () => {
      const send = vi.fn(async (method: string) => {
        if (method === 'Page.getLayoutMetrics') {
          return { cssContentSize: { width: 390, height: 1200 } };
        }
        if (method === 'Page.captureScreenshot') {
          return { data: 'full-page-data' };
        }
        return { result: {} };
      });
      const result = await captureShot({ send } as unknown as DebuggerSession, {
        ...shot,
        capture: { mode: 'full-page' },
      });
      expect(result).toBe('data:image/webp;base64,full-page-data');
      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'webp',
        quality: 100,
        fromSurface: true,
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 390, height: 1200, scale: 1 },
      });
    });

    it('enables captureBeyondViewport when selected in options', async () => {
      const send = vi.fn(async (method: string) => {
        if (method === 'Page.getLayoutMetrics') {
          return { cssContentSize: { width: 390, height: 1200 } };
        }
        if (method === 'Page.captureScreenshot') {
          return { data: 'full-page-data' };
        }
        return { result: {} };
      });
      const result = await captureShot(
        { send } as unknown as DebuggerSession,
        { ...shot, capture: { mode: 'full-page' } },
        { captureBeyondViewport: true },
      );
      expect(result).toBe('data:image/webp;base64,full-page-data');
      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'webp',
        quality: 100,
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 390, height: 1200, scale: 1 },
      });
    });
  });

  describe('element mode', () => {
    it('defaults captureBeyondViewport to false unless selected in options', async () => {
      const send = vi.fn(async (method: string) => {
        if (method === 'Runtime.evaluate') {
          return { result: { value: { x: 20, y: 100, width: 350, height: 200 } } };
        }
        if (method === 'Page.captureScreenshot') {
          return { data: 'element-data' };
        }
        return { result: {} };
      });
      const result = await captureShot({ send } as unknown as DebuggerSession, {
        ...shot,
        capture: { mode: 'element', selector: '#target-card' },
      });
      expect(result).toBe('data:image/webp;base64,element-data');
      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'webp',
        quality: 100,
        fromSurface: true,
        captureBeyondViewport: false,
        clip: { x: 20, y: 100, width: 350, height: 200, scale: 1 },
      });
    });

    it('enables captureBeyondViewport when specified on shot capture options', async () => {
      const send = vi.fn(async (method: string) => {
        if (method === 'Runtime.evaluate') {
          return { result: { value: { x: 20, y: 100, width: 350, height: 200 } } };
        }
        if (method === 'Page.captureScreenshot') {
          return { data: 'element-data' };
        }
        return { result: {} };
      });
      const result = await captureShot({ send } as unknown as DebuggerSession, {
        ...shot,
        capture: { mode: 'element', selector: '#target-card', captureBeyondViewport: true },
      });
      expect(result).toBe('data:image/webp;base64,element-data');
      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'webp',
        quality: 100,
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: 20, y: 100, width: 350, height: 200, scale: 1 },
      });
    });
  });
});
