import { describe, expect, it, vi } from 'vitest';
import { withCleanup } from '../src/capture/cleanup';

describe('withCleanup', () => {
  it('runs cleanup after a failed operation', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    await expect(
      withCleanup(async () => {
        throw new Error('action failed');
      }, cleanup),
    ).rejects.toThrow('action failed');
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
