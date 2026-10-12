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

/** Reads every completed download and decodes its pixel dimensions in Chromium. */
export async function savedImages(controller: Page): Promise<SavedImage[]> {
  const items = await controller.evaluate(() =>
    chrome.downloads.search({ orderBy: ['startTime'], state: 'complete' }),
  );
  const images: SavedImage[] = [];
  for (const item of items) {
    const base64 = readFileSync(item.filename).toString('base64');
    images.push(
      await controller.evaluate(async (data) => {
        const image = new Image();
        image.src = `data:image/webp;base64,${data}`;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      }, base64),
    );
  }
  return images;
}
