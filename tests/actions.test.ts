import { describe, expect, it, vi } from 'vitest';
import { runActions, type ActionDriver } from '../src/capture/actions';

function driver(): ActionDriver {
  return {
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    selectIndex: vi.fn().mockResolvedValue(undefined),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    waitForUrl: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
  };
}

describe('runActions', () => {
  it('runs declarative actions in order', async () => {
    const calls: string[] = [];
    const mockDriver = driver();
    vi.mocked(mockDriver.click).mockImplementation(async () => void calls.push('click'));
    vi.mocked(mockDriver.selectIndex).mockImplementation(async () => void calls.push('select'));
    vi.mocked(mockDriver.scrollTo).mockImplementation(async () => void calls.push('scroll'));

    await runActions(
      [
        { type: 'click', selector: '#open' },
        { type: 'select-index', selector: 'select', index: 1 },
        { type: 'scroll-to', selector: '#target' },
      ],
      mockDriver,
    );
    expect(calls).toEqual(['click', 'select', 'scroll']);
  });

  it('adds the action and selector to failures', async () => {
    const mockDriver = driver();
    vi.mocked(mockDriver.click).mockRejectedValue(new Error('not clickable'));
    await expect(runActions([{ type: 'click', selector: '#missing' }], mockDriver)).rejects.toThrow(
      'Action 1 (click) failed. Selector: #missing. not clickable',
    );
  });
});
