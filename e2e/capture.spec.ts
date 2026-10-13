import { readFileSync } from 'node:fs';

import {
  expect,
  FIXTURE_CARD_POINT,
  isCardWhite,
  savedImages,
  savedPixels,
  test,
} from './fixtures';

const { x: cardX, y: cardY } = FIXTURE_CARD_POINT;

const footer = '.capture-footer';

test('batch capture writes iPhone 14 Pro Max images at 1290 × 2796', async ({
  context,
  controller,
}) => {
  await controller.getByRole('checkbox', { name: /Prepare each shot manually/ }).uncheck();
  await controller.getByRole('button', { name: 'Capture 2 shots' }).click();

  await expect(controller.locator(footer)).toContainText('2 images saved', { timeout: 90_000 });
  expect(await savedImages(controller)).toEqual([
    { width: 1290, height: 2796 },
    { width: 1290, height: 2796 },
  ]);
  const [overview] = await savedPixels(controller, cardX, cardY);
  expect(isCardWhite(overview!)).toBe(true);
  // Saved images can be reviewed in the controller at their real size.
  await controller.getByRole('button', { name: 'Preview Fixture details' }).click();
  const dialog = controller.getByRole('dialog', { name: 'Fixture details' });
  await expect(dialog).toContainText('demo-02-details.webp · 1290 × 2796');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  // The dedicated capture window closes after a successful run.
  await expect
    .poll(() => context.pages().filter((page) => page.url().includes('/fixture/')).length)
    .toBe(0);
});

test('native zoom changes layout but not output dimensions', async ({ controller }) => {
  await controller.getByRole('checkbox', { name: /Prepare each shot manually/ }).uncheck();
  await controller.getByLabel('Browser zoom (%)').fill('200');
  await controller.getByRole('checkbox', { name: 'Select Fixture details' }).uncheck();
  await controller.getByRole('button', { name: 'Capture 1 shot' }).click();

  await expect(controller.locator(footer)).toContainText('1 image saved', { timeout: 90_000 });
  expect(await savedImages(controller)).toEqual([{ width: 1290, height: 2796 }]);
});

test('full-page capture keeps viewport width and grows with the document', async ({
  controller,
}) => {
  await controller.getByRole('checkbox', { name: /Prepare each shot manually/ }).uncheck();
  await controller.getByRole('checkbox', { name: /Capture full page/ }).check();
  await controller.getByRole('checkbox', { name: 'Select Fixture details' }).uncheck();
  await controller.getByRole('button', { name: 'Capture 1 shot' }).click();

  await expect(controller.locator(footer)).toContainText('1 image saved', { timeout: 90_000 });
  const [image] = await savedImages(controller);
  expect(image?.width).toBe(1290);
  // The fixture body is at least 150vh tall.
  expect(image?.height).toBeGreaterThanOrEqual(Math.floor(932 * 1.5 * 3));
  const [card] = await savedPixels(controller, cardX, cardY);
  expect(isCardWhite(card!)).toBe(true);
});

test('manual preparation captures, retakes, and moves to the next shot', async ({ controller }) => {
  await controller.getByRole('button', { name: 'Open 2 shots' }).click();

  await controller.getByRole('button', { name: 'Capture current view' }).click({ timeout: 60_000 });
  await expect(controller.getByText('Image saved. You can retake it or move on.')).toBeVisible({
    timeout: 60_000,
  });
  await controller.getByRole('button', { name: 'Retake current view' }).click();
  await expect(controller.getByText('Image saved. You can retake it or move on.')).toBeVisible({
    timeout: 60_000,
  });
  await controller.getByRole('button', { name: 'Next shot' }).click();
  // Capture the second shot as soon as it opens: the case that used to read a
  // frame rendered at the real window size right after an in-window navigation.
  await controller.getByRole('button', { name: 'Capture current view' }).click({ timeout: 60_000 });
  await controller.getByRole('button', { name: 'Finish' }).click({ timeout: 60_000 });

  await expect(controller.locator(footer)).toContainText('2 images saved', { timeout: 60_000 });
  expect(await savedImages(controller)).toEqual([
    { width: 1290, height: 2796 },
    { width: 1290, height: 2796 },
    { width: 1290, height: 2796 },
  ]);
  // Every capture shows the fully painted page, not a repeated top band.
  const pixels = await savedPixels(controller, cardX, cardY);
  expect(pixels.map(isCardWhite)).toEqual([true, true, true]);
});

test('manual preparation can skip every shot', async ({ controller }) => {
  await controller.getByRole('button', { name: 'Open 2 shots' }).click();
  await controller.getByRole('button', { name: 'Skip shot' }).click({ timeout: 60_000 });
  await controller.getByRole('button', { name: 'Skip shot' }).click({ timeout: 60_000 });
  await expect(controller.getByText('2 shots skipped')).toBeVisible({ timeout: 60_000 });
  expect(await savedImages(controller)).toEqual([]);
});

test('dark color scheme renders the page in dark mode', async ({ controller }) => {
  await controller.getByRole('checkbox', { name: /Prepare each shot manually/ }).uncheck();
  await controller.getByLabel('Color scheme').selectOption('dark');
  await controller.getByRole('checkbox', { name: 'Select Fixture details' }).uncheck();
  await controller.getByRole('button', { name: 'Capture 1 shot' }).click();

  await expect(controller.locator(footer)).toContainText('1 image saved', { timeout: 90_000 });
  // The fixture's dark background is #1d1c19; light mode would be #f3efe4.
  const [background] = await savedPixels(controller, 215, 900);
  expect(Math.max(...background!)).toBeLessThan(60);
});

test('PNG format saves lossless images at the same size', async ({ controller }) => {
  await controller.getByRole('checkbox', { name: /Prepare each shot manually/ }).uncheck();
  await controller.getByLabel('Image format').selectOption('png');
  await controller.getByRole('checkbox', { name: 'Select Fixture details' }).uncheck();
  await controller.getByRole('button', { name: 'Capture 1 shot' }).click();

  await expect(controller.locator(footer)).toContainText('1 image saved', { timeout: 90_000 });
  const [item] = await controller.evaluate(() => chrome.downloads.search({ state: 'complete' }));
  // PNG signature: 0x89 'P' 'N' 'G'.
  expect([...readFileSync(item!.filename).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(await savedImages(controller)).toEqual([{ width: 1290, height: 2796 }]);
  const [card] = await savedPixels(controller, cardX, cardY);
  expect(isCardWhite(card!)).toBe(true);
});

test('extra viewports capture each shot once per viewport', async ({ controller }) => {
  await controller.getByRole('checkbox', { name: /Prepare each shot manually/ }).uncheck();
  await controller.getByText('Also capture at').click();
  await controller.getByRole('checkbox', { name: 'Desktop — 1440 × 1000' }).check();
  await controller.getByRole('checkbox', { name: 'Select Fixture details' }).uncheck();
  await controller.getByRole('button', { name: 'Capture 1 shot' }).click();

  await expect(controller.locator(footer)).toContainText('2 images saved', { timeout: 90_000 });
  await expect(controller.locator(footer)).toContainText('in 2 viewport folders');
  expect(await savedImages(controller)).toEqual([
    { width: 1290, height: 2796 },
    { width: 1440, height: 1000 },
  ]);
});

test('closing the controller mid-run closes its capture window', async ({
  context,
  controller,
}) => {
  await controller.getByRole('button', { name: 'Open 2 shots' }).click();
  await controller
    .getByRole('button', { name: 'Capture current view' })
    .waitFor({ timeout: 60_000 });
  const capturePages = () => context.pages().filter((page) => page.url().includes('/fixture/'));
  expect(capturePages()).toHaveLength(1);

  await controller.close();
  await expect.poll(() => capturePages().length, { timeout: 15_000 }).toBe(0);
});
