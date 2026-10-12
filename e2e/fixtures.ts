import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';

import { FIXTURE_ORIGIN } from '../playwright.config';

const extensionPath = resolve(import.meta.dirname, '../dist');

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  controller: Page;
}

export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'say-cheese-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      // Playwright would otherwise emulate its own viewport on every page,
      // including the extension's capture window, and fight its emulation.
      viewport: null,
      // Likewise, let the extension own prefers-color-scheme.
      colorScheme: null,
      acceptDownloads: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },
  controller: async ({ context, extensionId }, use, testInfo) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/controller/index.html`);
    await page.getByLabel('Base URL').fill(FIXTURE_ORIGIN);
    // Pin light mode so content checks do not depend on the machine's theme.
    await page.getByLabel('Color scheme').selectOption('light');
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      // Keep the controller's last state with the failure; CI uploads test-results/.
      const path = testInfo.outputPath('controller.png');
      await page.screenshot({ path, fullPage: true });
      await testInfo.attach('controller', { path, contentType: 'image/png' });
    }
  },
});

export { expect } from '@playwright/test';

export interface SavedImage {
  width: number;
  height: number;
}

type Rgb = [number, number, number];

async function decodeDownloads<T>(
  controller: Page,
  read: (data: string) => Promise<T>,
): Promise<T[]> {
  const items = await controller.evaluate(() =>
    chrome.downloads.search({ orderBy: ['startTime'], state: 'complete' }),
  );
  const results: T[] = [];
  for (const item of items)
    results.push(await read(readFileSync(item.filename).toString('base64')));
  return results;
}

/** Reads every completed download and decodes its pixel dimensions in Chromium. */
export function savedImages(controller: Page): Promise<SavedImage[]> {
  return decodeDownloads(controller, (data) =>
    controller.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/webp;base64,${base64}`;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, data),
  );
}

/** Samples each saved image at a CSS-pixel point, scaled by the 3× phone DPR. */
export function savedPixels(controller: Page, x: number, y: number): Promise<Rgb[]> {
  return decodeDownloads(controller, (data) =>
    controller.evaluate(
      async ({ base64, x, y }) => {
        const image = new Image();
        image.src = `data:image/webp;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const [r, g, b] = context.getImageData(x * 3, y * 3, 1, 1).data;
        return [r!, g!, b!] as Rgb;
      },
      { base64: data, x, y },
    ),
  );
}

/**
 * The fixture's first card sits around CSS y 460–640 and is lighter (#fffdf8)
 * than the page background (#f3efe4). A partially painted capture repeats the
 * page's top band instead, so the card's pixels come back as background.
 */
export const FIXTURE_CARD_POINT = { x: 215, y: 600 } as const;

export function isCardWhite([r, g, b]: Rgb): boolean {
  return r >= 250 && g >= 248 && b >= 240;
}
