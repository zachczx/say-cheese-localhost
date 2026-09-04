import { mount } from 'svelte';

import App from './App.svelte';

if (location.protocol !== 'chrome-extension:') {
  const values: Record<string, unknown> = {};
  const previewChrome = {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: values[key] };
        },
        async set(items: Record<string, unknown>) {
          Object.assign(values, items);
        },
      },
    },
    tabs: {
      async create() {
        return undefined;
      },
    },
  };
  Object.defineProperty(globalThis, 'chrome', {
    value: previewChrome,
    configurable: true,
  });
}

const target = document.getElementById('app');
if (!target) throw new Error('Missing controller application root.');

mount(App, { target });
