import type { CaptureProfile } from '../schema';

export const demoProfile: CaptureProfile = {
  id: 'local-demo',
  label: 'Local demo',
  defaultBaseUrl: 'http://localhost:5173',
  outputDirectory: 'say-cheese-localhost/demo',
  defaultViewport: 'phone',
  shots: [
    {
      id: 'fixture-overview',
      label: 'Fixture overview',
      path: '/fixture/',
      filename: 'demo-01-overview.webp',
      enabledByDefault: true,
      ready: [{ type: 'selector', selector: '[data-capture-ready="true"]' }],
    },
    {
      id: 'fixture-details',
      label: 'Fixture details',
      path: '/fixture/?state=details',
      filename: 'demo-02-details.webp',
      enabledByDefault: true,
      ready: [{ type: 'selector', selector: '[data-state="details"]' }],
      actions: [{ type: 'scroll-to', selector: '#details', topOffset: 24 }],
    },
  ],
};
