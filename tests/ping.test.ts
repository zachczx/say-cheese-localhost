import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { pingAddress } from '../src/capture/ping';

describe('pingAddress', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports reachable with status code and latency on successful HTTP 200', async () => {
    const cancelMock = vi.fn();
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      body: { cancel: cancelMock },
    } as unknown as Response);

    const result = await pingAddress('http://localhost:5173');

    expect(result.reachable).toBe(true);
    expect(result.status).toBe(200);
    expect(result.statusText).toBe('OK');
    expect(typeof result.latencyMs).toBe('number');
    expect(cancelMock).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:5173/',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('supports https loopback addresses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
    } as Response);

    const result = await pingAddress('https://localhost:8443');

    expect(result.reachable).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://localhost:8443/',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reports reachable when server responds with 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 404,
      statusText: 'Not Found',
    } as Response);

    const result = await pingAddress('http://127.0.0.1:5174');

    expect(result.reachable).toBe(true);
    expect(result.status).toBe(404);
    expect(result.statusText).toBe('Not Found');
  });

  it('falls back to no-cors mode when standard fetch fails with a CORS error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        status: 0,
        statusText: '',
      } as Response);

    globalThis.fetch = fetchMock;

    const result = await pingAddress('http://localhost:3000');

    expect(result.reachable).toBe(true);
    expect(result.statusText).toBe('Connected');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ mode: 'no-cors' }));
  });

  it('reports unreachable when both standard and no-cors fetch fail (connection refused)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await pingAddress('http://127.0.0.1:59999');

    expect(result.reachable).toBe(false);
    expect(result.error).toBe('Connection refused or unreachable');
  });

  it('reports timed out when request exceeds timeout duration', async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new DOMException('The operation was aborted', 'TimeoutError'));
          }, 50);
        }),
    );

    const result = await pingAddress('http://localhost:5173', { timeoutMs: 10 });

    expect(result.reachable).toBe(false);
    expect(result.error).toBe('Connection timed out');
  });

  it('handles pre-aborted signal cleanly without hanging', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const controller = new AbortController();
    controller.abort(new DOMException('Operation aborted', 'AbortError'));

    const result = await pingAddress('http://localhost:5173', { signal: controller.signal });

    expect(result.reachable).toBe(false);
    expect(result.error).toBe('Request aborted');
  });

  it('rejects non-loopback addresses without sending network requests', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const result = await pingAddress('https://google.com');

    expect(result.reachable).toBe(false);
    expect(result.error).toContain('Base URL must point to localhost or a loopback address.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
