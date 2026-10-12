export const DEFAULT_PAGE_ZOOM_PERCENT = 100;
export const MIN_PAGE_ZOOM_PERCENT = 25;
export const MAX_PAGE_ZOOM_PERCENT = 500;

export function normalizePageZoomPercent(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < MIN_PAGE_ZOOM_PERCENT ||
    value > MAX_PAGE_ZOOM_PERCENT
  ) {
    return DEFAULT_PAGE_ZOOM_PERCENT;
  }
  return value;
}

export async function applyPageZoom(
  tabId: number,
  value: unknown = DEFAULT_PAGE_ZOOM_PERCENT,
): Promise<void> {
  const factor = normalizePageZoomPercent(value) / 100;
  await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' });
  // Re-applying the same zoom still relayouts and re-rasters the page, which can
  // leave a partially painted frame for an immediate capture. Skip no-op changes.
  const current = await chrome.tabs.getZoom(tabId);
  if (Math.abs(current - factor) < 0.0001) return;
  await chrome.tabs.setZoom(tabId, factor);
}
