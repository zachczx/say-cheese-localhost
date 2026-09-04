import type { ViewportPreset } from './schema';

export const VIEWPORTS = [
  {
    id: 'phone',
    label: 'Phone — 390 × 844',
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true,
  },
  {
    id: 'tablet',
    label: 'Tablet — 768 × 1024',
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
  },
  {
    id: 'desktop',
    label: 'Desktop — 1440 × 1000',
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
    touch: false,
  },
] as const satisfies readonly ViewportPreset[];
