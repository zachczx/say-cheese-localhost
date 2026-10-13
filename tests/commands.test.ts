import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CAPTURE_COMMAND } from '../src/commands';

describe('capture command', () => {
  it('is declared in the manifest', () => {
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf-8')) as {
      commands?: Record<string, unknown>;
    };
    expect(manifest.commands?.[CAPTURE_COMMAND]).toBeDefined();
  });
});
