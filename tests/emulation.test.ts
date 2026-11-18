import { describe, expect, it, vi } from 'vitest';

import type { DebuggerSession } from '../src/capture/debugger';
import { applyEmulation, clearEmulation, isValidTimezone } from '../src/capture/emulation';
import { VIEWPORTS } from '../src/profiles/viewports';

function session() {
  const send = vi.fn(async () => undefined);
  return { send, attached: true, session: { send, attached: true } as unknown as DebuggerSession };
}

describe('emulation', () => {
  it('pins Asia/Singapore by default and leaves the color scheme alone', async () => {
    const { send, session: target } = session();
    await applyEmulation(target, VIEWPORTS[0]);
    expect(send).toHaveBeenCalledWith('Emulation.setTimezoneOverride', {
      timezoneId: 'Asia/Singapore',
    });
    expect(send).not.toHaveBeenCalledWith('Emulation.setEmulatedMedia', expect.anything());
  });

  it('applies a profile timezone and a forced color scheme', async () => {
    const { send, session: target } = session();
    await applyEmulation(target, VIEWPORTS[0], {
      timezoneId: 'America/New_York',
      colorScheme: 'dark',
    });
    expect(send).toHaveBeenCalledWith('Emulation.setTimezoneOverride', {
      timezoneId: 'America/New_York',
    });
    expect(send).toHaveBeenCalledWith('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    });
  });

  it('keeps capturing when Chrome refuses the timezone override', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'Emulation.setTimezoneOverride') {
        throw new Error(
          '{"code":-32000,"message":"Timezone override is only available to trusted clients"}',
        );
      }
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const target = { send, attached: true } as unknown as DebuggerSession;
    await applyEmulation(target, VIEWPORTS[0], { colorScheme: 'dark' });
    expect(send).toHaveBeenCalledWith('Emulation.setEmulatedMedia', expect.anything());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still fails on other timezone override errors', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'Emulation.setTimezoneOverride') throw new Error('Invalid timezone ID');
    });
    const target = { send, attached: true } as unknown as DebuggerSession;
    await expect(applyEmulation(target, VIEWPORTS[0])).rejects.toThrow('Invalid timezone ID');
  });

  it('clears every override when the job ends', async () => {
    const { send, session: target } = session();
    await clearEmulation(target);
    expect(send).toHaveBeenCalledWith('Emulation.setEmulatedMedia', { media: '', features: [] });
    expect(send).toHaveBeenCalledWith('Emulation.setTimezoneOverride', { timezoneId: '' });
  });

  it('recognizes IANA time zones', () => {
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false);
  });
});
