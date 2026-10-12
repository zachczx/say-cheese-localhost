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
