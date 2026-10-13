import type { ViewportPreset } from '../profiles/schema';
import type { DebuggerSession } from './debugger';

/** `system` leaves the operating system's preference in place. */
export type ColorScheme = 'system' | 'light' | 'dark';

export const DEFAULT_TIMEZONE = 'Asia/Singapore';

export interface EmulationOptions {
  timezoneId?: string;
  colorScheme?: ColorScheme;
}

export async function applyEmulation(
  session: DebuggerSession,
  viewport: ViewportPreset,
  options: EmulationOptions = {},
): Promise<void> {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    positionX: 0,
    positionY: 0,
    dontSetVisibleSize: false,
  });
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: viewport.touch,
    maxTouchPoints: viewport.touch ? 5 : 1,
  });
  await session.send('Emulation.setTimezoneOverride', {
    timezoneId: options.timezoneId ?? DEFAULT_TIMEZONE,
  });
  if (options.colorScheme && options.colorScheme !== 'system') {
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: options.colorScheme }],
    });
  }
}

export async function clearEmulation(session: DebuggerSession): Promise<void> {
  if (!session.attached) return;
  await Promise.allSettled([
    session.send('Emulation.clearDeviceMetricsOverride'),
    session.send('Emulation.setTouchEmulationEnabled', { enabled: false }),
    session.send('Emulation.setTimezoneOverride', { timezoneId: '' }),
    session.send('Emulation.setEmulatedMedia', { media: '', features: [] }),
  ]);
}

/** True when the runtime recognizes the IANA time zone name. */
export function isValidTimezone(timezoneId: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezoneId });
    return true;
  } catch {
    return false;
  }
}
