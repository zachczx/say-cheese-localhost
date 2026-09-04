// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebuggerSession } from '../src/capture/debugger';
import { prepareDocument, waitForDocumentAssets } from '../src/capture/readiness';

const session = {
  send: async (_method: string, params: { expression: string }) => {
    try {
      return { result: { value: await window.eval(params.expression) } };
    } catch (error) {
      return { result: {}, exceptionDetails: { text: String(error) } };
    }
  },
} as unknown as DebuggerSession;

function addImage(top = 10, loaded = true) {
  const image = document.createElement('img');
  image.src = 'https://example.test/image?secret=never-expose';
  Object.defineProperties(image, {
    complete: { value: true, configurable: true },
    naturalWidth: { value: loaded ? 100 : 0 },
    naturalHeight: { value: loaded ? 100 : 0 },
  });
  image.getBoundingClientRect = () =>
    ({ top, bottom: top + 100, left: 10, right: 110, width: 100, height: 100 }) as DOMRect;
  image.decode = vi.fn().mockResolvedValue(undefined);
  document.body.append(image);
  return image;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.restoreAllMocks();
});

describe('capture asset readiness', () => {
  it('decodes usable images in the viewport', async () => {
    const image = addImage();
    await waitForDocumentAssets(session);
    expect(image.decode).toHaveBeenCalledOnce();
  });

  it('rejects completed broken images without exposing their URL', async () => {
    addImage(10, false);
    await expect(waitForDocumentAssets(session)).rejects.toThrow(
      '1 image(s) in the capture area failed to load. Reload or fix the images, then retry.',
    );
  });

  it('ignores offscreen and hidden images for a viewport capture', async () => {
    addImage(2000, false);
    const hidden = addImage(10, false);
    hidden.style.visibility = 'hidden';
    await expect(waitForDocumentAssets(session)).resolves.toBeUndefined();
  });

  it('rejects failed decoding even when dimensions are available', async () => {
    addImage().decode = vi.fn().mockRejectedValue(new Error('secret URL'));
    await expect(waitForDocumentAssets(session)).rejects.toThrow(
      'Images in the capture area could not be decoded. Reload or fix the images, then retry.',
    );
  });

  it('times out while an image is still loading', async () => {
    Object.defineProperty(addImage(), 'complete', { value: false });
    await expect(waitForDocumentAssets(session, undefined, 10)).rejects.toThrow(
      'Fonts or images in the capture area did not become ready',
    );
  });

  it('checks images below the viewport for full-page captures', async () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 3000,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, 'scrollWidth', {
      value: 1024,
      configurable: true,
    });
    addImage(2000, false);
    await expect(
      waitForDocumentAssets(session, undefined, 100, { mode: 'full-page' }),
    ).rejects.toThrow('failed to load');
  });

  it('uses the selected element area instead of the viewport', async () => {
    const target = document.createElement('section');
    target.id = 'target';
    target.getBoundingClientRect = () =>
      ({ top: 1900, bottom: 2200, left: 0, right: 500 }) as DOMRect;
    document.body.append(target);
    addImage(2000, false);
    await expect(
      waitForDocumentAssets(session, undefined, 100, { mode: 'element', selector: '#target' }),
    ).rejects.toThrow('failed to load');
  });
});

it('preserves manually prepared scroll, zoom, and focus', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
  document.documentElement.style.zoom = '1.25';
  await prepareDocument(session, undefined, true);
  expect(scroll).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
  expect(document.documentElement.style.zoom).toBe('1.25');
  expect(document.querySelector('style')?.textContent).toContain('caret-color:transparent');
});
