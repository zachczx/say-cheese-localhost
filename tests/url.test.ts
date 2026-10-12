import { describe, expect, it } from 'vitest';

import {
  isLoopbackHostname,
  matchesUrlPattern,
  normalizeLocalBaseUrl,
  wildcardToRegExp,
} from '../src/capture/url';

describe('URL helpers', () => {
  it('accepts only localhost and loopback hostnames', () => {
    for (const host of ['localhost', 'app.localhost', 'LOCALHOST', '127.0.0.1', '[::1]']) {
      expect(isLoopbackHostname(host)).toBe(true);
    }
    for (const host of ['example.com', 'localhost.example.com', '127.0.0.2', '10.0.0.1']) {
      expect(isLoopbackHostname(host)).toBe(false);
    }
  });

  it('normalizes a loopback base URL and drops its fragment', () => {
    expect(normalizeLocalBaseUrl('http://127.0.0.1:5174/app#top')).toBe(
      'http://127.0.0.1:5174/app',
    );
    expect(() => normalizeLocalBaseUrl('https://example.com')).toThrow(/localhost/);
    expect(() => normalizeLocalBaseUrl('file:///C:/')).toThrow(/HTTP or HTTPS/);
    expect(() => normalizeLocalBaseUrl('not a url')).toThrow(/valid/);
  });

  it('matches wildcards and treats other characters literally', () => {
    expect(wildcardToRegExp('http://localhost:*/app/*').test('http://localhost:5173/app/x')).toBe(
      true,
    );
    expect(matchesUrlPattern('http://localhostX/a.b', 'http://localhost/a.b')).toBe(false);
    expect(matchesUrlPattern('http://localhost/a?b', 'http://localhost/a?b')).toBe(true);
  });
});
