import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', '.tmp/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'vite.config.ts'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },
  {
    files: ['vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
