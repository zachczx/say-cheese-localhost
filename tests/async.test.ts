import { describe, expect, it } from 'vitest';
import { delay, runWithTimeout } from '../src/capture/async';

describe('runWithTimeout', () => {
  it('aborts cooperative work with a useful timeout', async () => {
    await expect(
      runWithTimeout((signal) => delay(100, signal), 5, 'Readiness stalled'),
    ).rejects.toThrow('Readiness stalled (5 ms).');
  });

  it('propagates parent cancellation', async () => {
    const controller = new AbortController();
    const operation = runWithTimeout(
      (signal) => delay(100, signal),
      500,
      'Too slow',
      controller.signal,
    );
    controller.abort(new DOMException('User stopped.', 'AbortError'));
    await expect(operation).rejects.toMatchObject({ name: 'AbortError', message: 'User stopped.' });
  });
});
