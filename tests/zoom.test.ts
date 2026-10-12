import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPageZoom,
  DEFAULT_PAGE_ZOOM_PERCENT,
  normalizePageZoomPercent,
} from '../src/capture/zoom';

const setZoom = vi.fn(async () => undefined);
const setZoomSettings = vi.fn(async () => undefined);
const getZoom = vi.fn(async () => 1);

beforeEach(() => {
  setZoom.mockClear();
  setZoomSettings.mockClear();
  getZoom.mockReset().mockResolvedValue(1);
  vi.stubGlobal('chrome', { tabs: { getZoom, setZoom, setZoomSettings } });
});

describe('page zoom', () => {
  it('applies an exact native tab zoom factor', async () => {
    await applyPageZoom(42, 220);
    expect(setZoomSettings).toHaveBeenCalledWith(42, {
      mode: 'automatic',
      scope: 'per-tab',
    });
    expect(setZoom).toHaveBeenCalledWith(42, 2.2);
    expect(setZoomSettings.mock.invocationCallOrder[0]).toBeLessThan(
      setZoom.mock.invocationCallOrder[0]!,
    );
  });

  it('skips a zoom change that would not change the factor', async () => {
    getZoom.mockResolvedValueOnce(2.2);
    await applyPageZoom(42, 220);
    expect(setZoomSettings).toHaveBeenCalledOnce();
    expect(setZoom).not.toHaveBeenCalled();
  });

  it('falls back to 100% for invalid or stale values', () => {
    expect(normalizePageZoomPercent(undefined)).toBe(DEFAULT_PAGE_ZOOM_PERCENT);
    expect(normalizePageZoomPercent(0)).toBe(DEFAULT_PAGE_ZOOM_PERCENT);
    expect(normalizePageZoomPercent(501)).toBe(DEFAULT_PAGE_ZOOM_PERCENT);
  });
});
