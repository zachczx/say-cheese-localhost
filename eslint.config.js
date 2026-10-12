import eslint from '@eslint/js';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', '.tmp/**', 'test-results/**', 'playwright-report/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'vite.config.ts'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },
  {
    files: ['src/**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },
  {
    files: ['vite.config.ts', 'playwright.config.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, chrome: 'readonly' } },
  },
);
