import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DebuggerEvent, DebuggerSession } from '../src/capture/debugger';
import { NetworkQuietTracker } from '../src/capture/readiness';

let tracker: NetworkQuietTracker;
let emit: (event: DebuggerEvent) => void;

beforeEach(() => {
  vi.useFakeTimers();
  tracker = new NetworkQuietTracker();
  tracker.start({
    onEvent(listener: typeof emit) {
      emit = listener;
      return () => {};
    },
  } as unknown as DebuggerSession);
});

afterEach(() => {
  tracker.stop();
  vi.useRealTimers();
});

function request(id: string, type: string, url: string) {
  emit({ method: 'Network.requestWillBeSent', params: { requestId: id, type, request: { url } } });
}

function finish(id: string) {
  emit({ method: 'Network.loadingFinished', params: { requestId: id } });
}

it('ignores optional remote traffic and assets checked by the visible-asset gate', async () => {
  request('remote', 'Fetch', 'https://analytics.example.test/events');
  request('image', 'Image', 'http://localhost:5173/offscreen.webp');
  request('font', 'Font', 'https://fonts.example.test/font.woff2');
  request('stream', 'EventSource', 'http://localhost:8080/events');
  request('ping', 'Ping', 'http://localhost:8080/beacon');
  const ready = expect(tracker.waitForQuiet()).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(450);
  finish('ping');
  finish('unknown');
  await vi.advanceTimersByTimeAsync(50);
  await ready;
});

it('waits for local API data on another port and remote page scripts', async () => {
  request('api', 'Fetch', 'http://127.0.0.1:8080/trips');
  request('script', 'Script', 'https://cdn.example.test/page.js');
  let done = false;
  const ready = tracker.waitForQuiet().then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(600);
  expect(done).toBe(false);
  finish('api');
  await vi.advanceTimersByTimeAsync(600);
  expect(done).toBe(false);
  finish('script');
  await vi.advanceTimersByTimeAsync(500);
  await ready;
  expect(done).toBe(true);
});

it('reports blocking requests without credentials, query strings, or fragments', async () => {
  request('api', 'XHR', 'http://user:password@localhost:8080/trips?token=secret#private');
  const failure = expect(tracker.waitForQuiet(undefined, 500, 1000)).rejects.toThrow(
    'Network did not become quiet (1000 ms). Pending requests: XHR http://localhost:8080/trips.',
  );
  await vi.advanceTimersByTimeAsync(1000);
  await failure;
});

it('releases fetch event streams when their response type is known', async () => {
  request('stream', 'Fetch', 'http://localhost:8080/events');
  emit({
    method: 'Network.responseReceived',
    params: {
      requestId: 'stream',
      response: { mimeType: 'text/event-stream' },
    },
  });
  const ready = expect(tracker.waitForQuiet()).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(500);
  await ready;
});

it('releases a local request redirected to an optional remote service', async () => {
  request('redirect', 'Fetch', 'http://localhost:8080/optional');
  request('redirect', 'Fetch', 'https://optional.example.test/data');
  const ready = expect(tracker.waitForQuiet()).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(500);
  await ready;
});

it('preserves cancellation instead of reporting a readiness failure', async () => {
  request('api', 'Fetch', 'http://localhost:8080/trips');
  const controller = new AbortController();
  const stopped = new DOMException('Capture stopped.', 'AbortError');
  const failure = expect(tracker.waitForQuiet(controller.signal)).rejects.toBe(stopped);
  controller.abort(stopped);
  await failure;
});
