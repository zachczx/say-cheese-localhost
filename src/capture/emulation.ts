import type { ViewportPreset } from '../profiles/schema';
import type { DebuggerSession } from './debugger';

export async function applyEmulation(
  session: DebuggerSession,
  viewport: ViewportPreset,
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
  await session.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Singapore' });
}

export async function clearEmulation(session: DebuggerSession): Promise<void> {
  if (!session.attached) return;
  await Promise.allSettled([
    session.send('Emulation.clearDeviceMetricsOverride'),
    session.send('Emulation.setTouchEmulationEnabled', { enabled: false }),
    session.send('Emulation.setTimezoneOverride', { timezoneId: '' }),
  ]);
}
