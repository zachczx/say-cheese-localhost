import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describePageException,
  retryWhileTabInitializes,
  runCaptureJob,
  type CaptureJobOptions,
} from '../src/capture/job';
import { VIEWPORTS } from '../src/profiles/viewports';
import { PROFILES } from '../src/profiles';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  prepare: vi.fn(),
  restoreScroll: vi.fn(),
  capture: vi.fn(),
  download: vi.fn(),
  waitDownload: vi.fn(),
  waitAssets: vi.fn(),
  waitPaint: vi.fn(),
  waitQuiet: vi.fn(),
  applyZoom: vi.fn(),
  detach: vi.fn(),
  send: vi.fn(),
  remove: vi.fn(),
  listeners: [] as Array<(event: { method: string; params: Record<string, unknown> }) => void>,
}));
vi.mock('../src/capture/debugger', () => ({
  DebuggerSession: class {
    attached = true;
    attach = vi.fn();
    send = mocks.send;
    onDetach = vi.fn();
    onEvent(fn: (typeof mocks.listeners)[number]) {
      mocks.listeners.push(fn);
      return () => {};
    }
    detach = mocks.detach;
  },
}));
vi.mock('../src/capture/navigation', () => ({ navigateAndWait: mocks.navigate }));
vi.mock('../src/capture/readiness', () => ({
  evaluate: vi.fn(async () => 'http://localhost:5173/fixture/?state=manually-opened'),
  prepareDocument: mocks.prepare,
  restoreDocumentScroll: mocks.restoreScroll,
  waitForDocumentAssets: mocks.waitAssets,
  waitForPaint: mocks.waitPaint,
  waitForReadyConditions: vi.fn(),
  NetworkQuietTracker: class {
    start() {}
    reset() {}
    stop() {}
    waitForQuiet = mocks.waitQuiet;
  },
}));
vi.mock('../src/capture/screenshot', async (importOriginal) => ({
  outputFilename: (await importOriginal<typeof import('../src/capture/screenshot')>())
    .outputFilename,
  captureShot: mocks.capture,
  downloadScreenshot: mocks.download,
  waitForDownload: mocks.waitDownload,
}));
vi.mock('../src/capture/zoom', () => ({ applyPageZoom: mocks.applyZoom }));

function options(): CaptureJobOptions {
  return {
    profile: PROFILES[0]!,
    baseUrl: 'http://localhost:5173',
    viewport: VIEWPORTS[0],
    shots: [PROFILES[0]!.shots[0]!],
    continueOnError: true,
    retainWindowAfterFailure: false,
    pageZoomPercent: 220,
  };
}

describe('manual capture lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.send.mockResolvedValue(undefined);
    mocks.detach.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    mocks.listeners.length = 0;
    mocks.navigate.mockResolvedValue({ status: 200 });
    mocks.capture.mockResolvedValue('data:image/webp;base64,example');
    mocks.download.mockResolvedValue(1);
    mocks.waitDownload.mockResolvedValue(undefined);
    mocks.waitAssets.mockResolvedValue(undefined);
    mocks.waitPaint.mockResolvedValue(true);
    mocks.waitQuiet.mockResolvedValue(undefined);
    mocks.applyZoom.mockResolvedValue(undefined);
    mocks.prepare.mockResolvedValue(undefined);
    mocks.restoreScroll.mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      windows: {
        create: vi.fn(async () => ({ id: 1, tabs: [{ id: 2 }] })),
        update: vi.fn(),
        remove: mocks.remove,
      },
      tabs: { setZoom: vi.fn() },
    });
  });

  it('retries setup while the new capture tab is still initializing', async () => {
    mocks.applyZoom.mockRejectedValueOnce(
      new Error(
        'Cannot access contents of the page. Extension manifest must request permission to access the respective host.',
      ),
    );
    const result = await runCaptureJob({ ...options(), onManualReady: async () => 'next' });
    expect(result.failures).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });

  it('writes into a run folder beneath the profile directory', async () => {
    await runCaptureJob({
      ...options(),
      outputSubdirectory: '2026-10-13_014502',
      onManualReady: vi.fn().mockResolvedValueOnce('capture').mockResolvedValueOnce('next'),
    });
    expect(mocks.download).toHaveBeenCalledWith(
      expect.any(String),
      'say-cheese-localhost/demo/2026-10-13_014502',
      'demo-01-overview.webp',
    );
  });

  it('saves PNG runs with a .png file name', async () => {
    await runCaptureJob({
      ...options(),
      format: 'png',
      onManualReady: vi.fn().mockResolvedValueOnce('capture').mockResolvedValueOnce('next'),
    });
    expect(mocks.capture.mock.calls[0]?.[2]).toMatchObject({ format: 'png' });
    expect(mocks.download).toHaveBeenCalledWith(
      expect.any(String),
      'say-cheese-localhost/demo',
      'demo-01-overview.png',
    );
  });

  it('lets each page settle before handing it to the user', async () => {
    const order: string[] = [];
    mocks.navigate.mockImplementation(async () => {
      order.push('navigate');
      return { status: 200 };
    });
    mocks.waitQuiet.mockImplementation(async () => void order.push('quiet'));
    mocks.waitPaint.mockImplementation(async () => {
      order.push('paint');
      return true;
    });
    await runCaptureJob({
      ...options(),
      shots: PROFILES[0]!.shots,
      onManualReady: async () => {
        order.push('user');
        return 'next';
      },
    });
    expect(order).toEqual([
      'navigate',
      'quiet',
      'paint',
      'user',
      'navigate',
      'quiet',
      'paint',
      'user',
    ]);
  });

  it('still opens a manual shot when the page never goes quiet', async () => {
    mocks.waitQuiet.mockRejectedValue(new Error('Network did not become quiet (5000 ms).'));
    const ready = vi.fn().mockResolvedValueOnce('capture').mockResolvedValueOnce('next');
    const result = await runCaptureJob({ ...options(), onManualReady: ready });
    expect(result.failures).toEqual([]);
    expect(result.completed).toBe(1);
    expect(mocks.waitQuiet.mock.calls[0]?.[2]).toBe(5_000);
  });

  it('waits for a painted frame before every capture', async () => {
    await runCaptureJob({
      ...options(),
      onManualReady: vi
        .fn()
        .mockResolvedValueOnce('capture')
        .mockResolvedValueOnce('capture')
        .mockResolvedValueOnce('next'),
    });
    // One wait while the page settles after navigation, then one before each capture.
    const paints = mocks.waitPaint.mock.invocationCallOrder;
    const captures = mocks.capture.mock.invocationCallOrder;
    expect(paints).toHaveLength(3);
    expect(paints[1]).toBeLessThan(captures[0]!);
    expect(paints[2]).toBeGreaterThan(captures[0]!);
    expect(paints[2]).toBeLessThan(captures[1]!);
  });

  it('retakes the prepared view without navigating or sweeping again', async () => {
    const ready = vi
      .fn()
      .mockResolvedValueOnce('capture')
      .mockResolvedValueOnce('capture')
      .mockResolvedValueOnce('next');
    const result = await runCaptureJob({ ...options(), onManualReady: ready });
    expect(result.completed).toBe(1);
    expect(result.failures).toEqual([]);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(mocks.applyZoom).toHaveBeenCalledWith(2, 220);
    expect(mocks.prepare.mock.calls.every((call) => call[2] === true)).toBe(true);
    expect(mocks.detach).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it('sweeps and captures the complete document when full-page mode is selected', async () => {
    const ready = vi.fn().mockResolvedValueOnce('capture').mockResolvedValueOnce('next');
    mocks.prepare.mockResolvedValueOnce({ x: 12, y: 640 });
    await runCaptureJob({ ...options(), fullPage: true, onManualReady: ready });

    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      true,
      true,
      true,
    );
    expect(mocks.waitAssets).toHaveBeenCalledWith(expect.anything(), expect.anything(), 15_000, {
      mode: 'full-page',
    });
    expect(mocks.capture).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      captureBeyondViewport: undefined,
      fullPage: true,
    });
    expect(mocks.restoreScroll).toHaveBeenCalledWith(expect.anything(), { x: 12, y: 640 });
    expect(mocks.capture.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.restoreScroll.mock.invocationCallOrder[0]!,
    );
    expect(mocks.restoreScroll.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.download.mock.invocationCallOrder[0]!,
    );
  });

  it('restores manual framing when a full-page screenshot fails', async () => {
    mocks.prepare.mockResolvedValueOnce({ x: 12, y: 640 });
    mocks.capture.mockRejectedValueOnce(new Error('Screenshot failed'));
    const ready = vi.fn().mockResolvedValueOnce('capture').mockResolvedValueOnce('next');

    const result = await runCaptureJob({ ...options(), fullPage: true, onManualReady: ready });

    expect(result.failures[0]?.message).toContain('Screenshot failed');
    expect(mocks.restoreScroll).toHaveBeenCalledWith(expect.anything(), { x: 12, y: 640 });
  });

  it('re-sweeps an automated full-page shot after profile actions', async () => {
    await runCaptureJob({ ...options(), fullPage: true });

    expect(mocks.prepare).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything());
    expect(mocks.prepare).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      false,
      true,
      true,
    );
    expect(mocks.capture).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      captureBeyondViewport: undefined,
      fullPage: true,
    });
  });

  it('does not report a failed download as saved and retries in place', async () => {
    mocks.waitDownload.mockRejectedValueOnce(new Error('Download interrupted'));
    const updates: string[] = [];
    const saved = vi.fn();
    const ready = vi
      .fn()
      .mockResolvedValueOnce('capture')
      .mockResolvedValueOnce('capture')
      .mockResolvedValueOnce('next');
    const result = await runCaptureJob({
      ...options(),
      onManualReady: ready,
      onShotUpdate: (u) => updates.push(u.status),
      onShotSaved: saved,
    });
    expect(updates.indexOf('failed')).toBeLessThan(updates.indexOf('complete'));
    // Only the attempt that finished downloading hands its image to the controller.
    expect(saved).toHaveBeenCalledOnce();
    expect(saved).toHaveBeenCalledWith('fixture-overview', 'data:image/webp;base64,example');
    expect(result.completed).toBe(1);
    expect(result.failures).toEqual([]);
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });

  it('reports skipping without claiming an image was saved', async () => {
    const result = await runCaptureJob({ ...options(), onManualReady: async () => 'next' });
    expect(result.completed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('allows human preparation beyond the shot timeout', async () => {
    vi.useFakeTimers();
    try {
      await runCaptureJob({
        ...options(),
        onManualReady: async (_shot, signal) => {
          await vi.advanceTimersByTimeAsync(60_000);
          expect(signal.aborted).toBe(false);
          return 'next';
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up when stopped while awaiting manual preparation', async () => {
    const controller = new AbortController();
    const result = await runCaptureJob({
      ...options(),
      signal: controller.signal,
      onManualReady: async () => {
        controller.abort(new DOMException('Stopped', 'AbortError'));
        throw controller.signal.reason;
      },
    });
    expect(result.stopped).toBe(true);
    expect(mocks.detach).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it('surfaces failed local API requests without query credentials', async () => {
    mocks.navigate.mockImplementationOnce(async () => {
      for (const notify of mocks.listeners) {
        notify({
          method: 'Network.requestWillBeSent',
          params: {
            requestId: 'x',
            type: 'Fetch',
            request: { url: 'http://127.0.0.1:7003/jobs?token=private' },
          },
        });
        notify({
          method: 'Network.responseReceived',
          params: { requestId: 'x', response: { status: 500 } },
        });
      }
      return { status: 200 };
    });
    const warnings = vi.fn();
    await runCaptureJob({ ...options(), onManualReady: async () => 'next', onWarnings: warnings });
    const diagnostic = JSON.stringify(warnings.mock.calls);
    expect(diagnostic).toContain('/jobs returned HTTP 500');
    expect(diagnostic).not.toContain('private');
  });
  it('applies profile timeouts to navigation and asset readiness', async () => {
    const base = options();
    await runCaptureJob({
      ...base,
      profile: { ...base.profile, timeouts: { navigationMs: 20_000, assetsMs: 25_000 } },
      onManualReady: vi.fn().mockResolvedValueOnce('capture').mockResolvedValueOnce('next'),
    });
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.anything(),
      20_000,
    );
    expect(mocks.waitAssets).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      25_000,
      undefined,
    );
  });

  it('reports page warnings only when the list changes', async () => {
    mocks.navigate.mockImplementationOnce(async () => {
      const emit = (method: string, params: Record<string, unknown>) => {
        for (const notify of mocks.listeners) notify({ method, params });
      };
      emit('Runtime.exceptionThrown', {});
      for (let index = 0; index < 50; index += 1) {
        emit('Network.dataReceived', { requestId: `noise-${index}` });
      }
      emit('Runtime.exceptionThrown', {});
      return { status: 200 };
    });
    const warnings = vi.fn();
    await runCaptureJob({ ...options(), onManualReady: async () => 'next', onWarnings: warnings });
    // Initial clear, then one exception warning. Noise and the duplicate do not re-emit.
    expect(warnings).toHaveBeenCalledTimes(2);
    expect(warnings.mock.calls[0]).toEqual([[]]);
    expect(warnings.mock.calls[1]?.[0]).toHaveLength(1);
  });

  it('counts a failed retake once when the user moves on', async () => {
    mocks.waitDownload
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Retake interrupted'));
    const ready = vi
      .fn()
      .mockResolvedValueOnce('capture')
      .mockResolvedValueOnce('capture')
      .mockResolvedValueOnce('next');
    const result = await runCaptureJob({ ...options(), onManualReady: ready });
    expect(result.completed).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.message).toContain('Retake interrupted');
  });
});

describe('page exception warnings', () => {
  it('keeps the first line of the exception and drops stack frames', () => {
    expect(
      describePageException({
        exceptionDetails: {
          text: 'Uncaught',
          exception: {
            description:
              "TypeError: Cannot read properties of undefined (reading 'id')\n    at http://127.0.0.1:5174/app.js?token=private:1:2",
          },
        },
      }),
    ).toBe("Uncaught exception: TypeError: Cannot read properties of undefined (reading 'id')");
  });

  it('uses thrown string values and falls back when nothing useful is available', () => {
    expect(describePageException({ exceptionDetails: { exception: { value: 'boom' } } })).toBe(
      'Uncaught exception: boom',
    );
    expect(describePageException({ exceptionDetails: { text: 'Uncaught' } })).toMatch(
      /uncaught exception\. Inspect/,
    );
    expect(describePageException({})).toMatch(/uncaught exception\. Inspect/);
  });

  it('truncates very long messages', () => {
    const message = describePageException({
      exceptionDetails: { exception: { description: `Error: ${'x'.repeat(500)}` } },
    });
    expect(message.length).toBeLessThan(240);
    expect(message.endsWith('…')).toBe(true);
  });
});

describe('retryWhileTabInitializes', () => {
  const uncommitted = new Error('Cannot access contents of the page. Extension manifest must ...');

  it('retries only the uncommitted-tab error and returns the eventual result', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(uncommitted)
      .mockRejectedValueOnce(uncommitted)
      .mockResolvedValueOnce('ready');
    await expect(
      retryWhileTabInitializes(operation, new AbortController().signal, 5, 1),
    ).resolves.toBe('ready');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('rethrows other errors immediately and gives up after the attempt limit', async () => {
    const other = vi.fn().mockRejectedValue(new Error('No tab with id: 2.'));
    await expect(
      retryWhileTabInitializes(other, new AbortController().signal, 5, 1),
    ).rejects.toThrow('No tab with id');
    expect(other).toHaveBeenCalledOnce();

    const stuck = vi.fn().mockRejectedValue(uncommitted);
    await expect(retryWhileTabInitializes(stuck, new AbortController().signal, 3, 1)).rejects.toBe(
      uncommitted,
    );
    expect(stuck).toHaveBeenCalledTimes(3);
  });
});
