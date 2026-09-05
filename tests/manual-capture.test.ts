import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCaptureJob, type CaptureJobOptions } from '../src/capture/job';
import { VIEWPORTS } from '../src/profiles/viewports';
import { PROFILES } from '../src/profiles';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  prepare: vi.fn(),
  capture: vi.fn(),
  download: vi.fn(),
  waitDownload: vi.fn(),
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
  waitForDocumentAssets: vi.fn(),
  waitForReadyConditions: vi.fn(),
  NetworkQuietTracker: class {
    start() {}
    reset() {}
    stop() {}
    async waitForQuiet() {}
  },
}));
vi.mock('../src/capture/screenshot', () => ({
  captureShot: mocks.capture,
  downloadScreenshot: mocks.download,
  waitForDownload: mocks.waitDownload,
}));

function options(): CaptureJobOptions {
  return {
    profile: PROFILES[0]!,
    baseUrl: 'http://localhost:5173',
    viewport: VIEWPORTS[0],
    shots: [PROFILES[0]!.shots[0]!],
    continueOnError: true,
    retainWindowAfterFailure: false,
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
    vi.stubGlobal('chrome', {
      windows: {
        create: vi.fn(async () => ({ id: 1, tabs: [{ id: 2 }] })),
        update: vi.fn(),
        remove: mocks.remove,
      },
      tabs: { setZoom: vi.fn() },
    });
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
    expect(mocks.prepare.mock.calls.every((call) => call[2] === true)).toBe(true);
    expect(mocks.detach).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it('does not report a failed download as saved and retries in place', async () => {
    mocks.waitDownload.mockRejectedValueOnce(new Error('Download interrupted'));
    const updates: string[] = [];
    const ready = vi
      .fn()
      .mockResolvedValueOnce('capture')
      .mockResolvedValueOnce('capture')
      .mockResolvedValueOnce('next');
    const result = await runCaptureJob({
      ...options(),
      onManualReady: ready,
      onShotUpdate: (u) => updates.push(u.status),
    });
    expect(updates.indexOf('failed')).toBeLessThan(updates.indexOf('complete'));
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
