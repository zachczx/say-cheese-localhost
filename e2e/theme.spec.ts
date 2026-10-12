import { expect, test } from './fixtures';

// Tints mix theme colors with an achromatic surface. Mixing in a polar space
// such as OKLCH interpolates hue toward the surface's 0° hue and turns green
// and amber tints pink, so check their rendered hue.
test('soft success and accent tints keep their hue', async ({ controller }) => {
  const hues = await controller.evaluate(() => {
    const probe = document.createElement('div');
    document.getElementById('app')?.append(probe);
    const hueOf = (token: string) => {
      probe.style.backgroundColor = `var(${token})`;
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.fillStyle = getComputedStyle(probe).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return { r: r!, g: g!, b: b! };
    };
    const result = { success: hueOf('--success-soft'), accent: hueOf('--accent-soft') };
    probe.remove();
    return result;
  });
  // Green tint: green channel dominates red.
  expect(hues.success.g).toBeGreaterThan(hues.success.r);
  // Amber tint: red and green both exceed blue, and green is not far below red.
  expect(hues.accent.r).toBeGreaterThan(hues.accent.b);
  expect(hues.accent.g).toBeGreaterThan(hues.accent.b);
});

test('status dots turn red when a run fails', async ({ controller }) => {
  await controller.getByLabel('Base URL').fill('http://127.0.0.1:5198');
  await controller.getByRole('checkbox', { name: /Prepare each shot manually/ }).uncheck();
  await controller.getByRole('button', { name: 'Capture 2 shots' }).click();
  await controller.locator('.error-banner').waitFor({ timeout: 90_000 });

  const colors = await controller.evaluate(() => {
    const dot = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!, '::before').backgroundColor;
    const probe = document.createElement('span');
    probe.style.color = 'var(--error)';
    document.getElementById('app')!.append(probe);
    const error = getComputedStyle(probe).color;
    probe.remove();
    return { tile: dot('.current-state strong'), row: dot('.status-badge'), error };
  });
  expect(colors.tile).toBe(colors.error);
  expect(colors.row).toBe(colors.error);
});
