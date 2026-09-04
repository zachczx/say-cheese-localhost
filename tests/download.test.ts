import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForDownload } from '../src/capture/screenshot';

let listeners: Set<(delta: chrome.downloads.DownloadDelta) => void>;
const search = vi.fn();

beforeEach(() => {
  listeners = new Set();
  search.mockReset().mockResolvedValue([{ id: 42, state: 'in_progress' }]);
  vi.stubGlobal('chrome', {
    downloads: {
      search,
      onChanged: {
        addListener: (listener: (delta: chrome.downloads.DownloadDelta) => void) =>
          listeners.add(listener),
        removeListener: (listener: (delta: chrome.downloads.DownloadDelta) => void) =>
          listeners.delete(listener),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('download completion', () => {
  it('requires completion of the requested download and removes its listener', async () => {
    const operation = waitForDownload(42);
    for (const listener of listeners) listener({ id: 43, state: { current: 'complete' } });
    expect(listeners.size).toBe(1);
    for (const listener of listeners) listener({ id: 42, state: { current: 'complete' } });
    await expect(operation).resolves.toBeUndefined();
    expect(listeners.size).toBe(0);
  });

  it('rejects interrupted downloads and removes its listener', async () => {
    const operation = waitForDownload(42);
    for (const listener of listeners) listener({ id: 42, state: { current: 'interrupted' } });
    await expect(operation).rejects.toThrow('Download was interrupted.');
    expect(listeners.size).toBe(0);
  });

  it('cleans up when the user cancels', async () => {
    const controller = new AbortController();
    const operation = waitForDownload(42, controller.signal);
    controller.abort(new DOMException('User stopped.', 'AbortError'));
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    expect(listeners.size).toBe(0);
  });

  it('bounds an unfinished download and removes its listener', async () => {
    await expect(waitForDownload(42, undefined, 10)).rejects.toThrow(
      'Download did not finish (10 ms).',
    );
    expect(listeners.size).toBe(0);
  });

  it('recognizes a download that completed before the listener was installed', async () => {
    search.mockResolvedValue([{ id: 42, state: 'complete' }]);
    await expect(waitForDownload(42)).resolves.toBeUndefined();
    expect(listeners.size).toBe(0);
  });
});
