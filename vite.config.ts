import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite';
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
    tailwindcss(),
    Icons({ compiler: 'svelte' }),
    svelte({ configFile: false }),
    svelteTesting(),
    {
      name: 'copy-extension-manifest',
      closeBundle() {
        const outDir = resolve(import.meta.dirname, 'dist');
        mkdirSync(outDir, { recursive: true });
        // package.json is the single source of truth for the extension version.
        const pkg = JSON.parse(
          readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'),
        ) as { version: string };
        const manifest = JSON.parse(
          readFileSync(resolve(import.meta.dirname, 'manifest.json'), 'utf8'),
        ) as Record<string, unknown>;
        writeFileSync(
          resolve(outDir, 'manifest.json'),
          `${JSON.stringify({ ...manifest, version: pkg.version }, null, 2)}
`,
        );
        // Ship every profile manifest as standalone JSON beside the bundle.
        const profilesDir = resolve(import.meta.dirname, 'src/profiles');
        for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
          const source = resolve(profilesDir, entry.name, 'manifest.json');
          if (!entry.isDirectory() || !existsSync(source)) continue;
          const target = resolve(outDir, 'profiles', entry.name);
          mkdirSync(target, { recursive: true });
          copyFileSync(source, resolve(target, 'manifest.json'));
        }
      },
    },
  ],
});
