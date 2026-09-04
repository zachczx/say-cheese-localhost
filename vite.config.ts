import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src'),
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, 'src/background.ts'),
        'controller/index': resolve(import.meta.dirname, 'src/controller/index.html'),
        'fixture/index': resolve(import.meta.dirname, 'src/fixture/index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
  },
  plugins: [
    {
      name: 'copy-extension-manifest',
      closeBundle() {
        const outDir = resolve(import.meta.dirname, 'dist');
        const cubbyProfileDir = resolve(outDir, 'profiles/cubby');
        mkdirSync(outDir, { recursive: true });
        mkdirSync(cubbyProfileDir, { recursive: true });
        copyFileSync(
          resolve(import.meta.dirname, 'manifest.json'),
          resolve(outDir, 'manifest.json'),
        );
        copyFileSync(
          resolve(import.meta.dirname, 'src/profiles/cubby/manifest.json'),
          resolve(cubbyProfileDir, 'manifest.json'),
        );
      },
    },
  ],
});
