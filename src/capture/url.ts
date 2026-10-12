/** Hostnames the extension may capture: localhost, *.localhost, and IPv4/IPv6 loopback. */
export function isLoopbackHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return (
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value === '127.0.0.1' ||
    value === '[::1]'
  );
}

export function normalizeLocalBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Base URL must be a valid HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Base URL must use HTTP or HTTPS.');
  }
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error('Base URL must point to localhost or a loopback address.');
  }
  url.hash = '';
  return url.href;
}

/** Converts a `*` wildcard pattern into an anchored regular expression. */
export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function matchesUrlPattern(url: string, pattern: string): boolean {
  return wildcardToRegExp(pattern).test(url);
}
