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

await import('./controller');

export {};
