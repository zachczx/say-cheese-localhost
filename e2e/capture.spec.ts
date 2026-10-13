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

test('manual preparation captures, retakes, and skips on request', async ({ controller }) => {
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
  await controller.getByRole('button', { name: 'Skip shot' }).click({ timeout: 60_000 });

  await expect(controller.locator(footer)).toContainText('1 image saved', { timeout: 60_000 });
  expect(await savedImages(controller)).toEqual([
    { width: 1290, height: 2796 },
    { width: 1290, height: 2796 },
  ]);
  // Both the capture and the retake show the fully painted page, not a repeated top band.
  const pixels = await savedPixels(controller, cardX, cardY);
  expect(pixels.map(isCardWhite)).toEqual([true, true]);
});
