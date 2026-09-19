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
  await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' });
  await chrome.tabs.setZoom(tabId, normalizePageZoomPercent(value) / 100);
}
