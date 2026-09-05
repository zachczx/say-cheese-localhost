// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import App from '../src/controller/App.svelte';
import { runCaptureJob, type CaptureJobOptions, type CaptureJobResult } from '../src/capture/job';

vi.mock('../src/capture/job', async () => {
  const actual = await vi.importActual<typeof import('../src/capture/job')>('../src/capture/job');
  return { ...actual, runCaptureJob: vi.fn() };
});

const runCaptureJobMock = vi.mocked(runCaptureJob);
let storageGetMock: Mock;
let storageSetMock: Mock;

describe('controller', () => {
  beforeEach(() => {
    runCaptureJobMock.mockReset();
    storageGetMock = vi.fn(async () => ({}));
    storageSetMock = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: {
            get: storageGetMock,
            set: storageSetMock,
          },
        },
        tabs: {
          create: vi.fn(async () => undefined),
        },
      },
    });
  });

  it('keeps the queue selection and header checkbox in sync', async () => {
    render(App);

    const capture = (await screen.findByRole('button', {
      name: 'Open 2 shots',
    })) as HTMLButtonElement;
    expect(capture.disabled).toBe(false);

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Fixture overview' }));

    const selectAll = screen.getByRole('checkbox', {
      name: 'Select all shots',
    }) as HTMLInputElement;
    expect(selectAll.indeterminate).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Open 1 shot' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await fireEvent.click(selectAll);
    expect(
      (await screen.findByRole('checkbox', {
        name: 'Clear all shot selections',
      })) as HTMLInputElement,
    ).toHaveProperty('checked', true);

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Clear all shot selections' }));
    await waitFor(() => {
      expect(
        (
          screen.getByRole('button', {
            name: 'Select shots to capture',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });
  });

  it('marks an invalid base URL immediately and explains it after blur', async () => {
    render(App);

    const baseUrl = (await screen.findByLabelText('Base URL')) as HTMLInputElement;
    await waitFor(() => expect(baseUrl.disabled).toBe(false));
    await fireEvent.input(baseUrl, { target: { value: 'https://example.com' } });

    expect(baseUrl.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('base-url-error')?.textContent).toBe('');

    await fireEvent.blur(baseUrl);
    expect(
      screen.getByText('Base URL must point to localhost or a loopback address.'),
    ).toBeTruthy();
  });

  it('recovers with safe defaults when saved settings cannot be loaded', async () => {
    storageGetMock.mockRejectedValueOnce(new Error('Storage unavailable'));
    render(App);

    expect(screen.getByText('Loading capture setup…')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    expect(
      await screen.findByText('Saved settings could not be loaded. Safe defaults are active.'),
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Open 2 shots' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('keeps working and reports a non-blocking preference write failure', async () => {
    storageSetMock.mockRejectedValueOnce(new Error('Storage unavailable'));
    render(App);

    await screen.findByRole('button', { name: 'Open 2 shots' });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Fixture overview' }));

    expect(
      await screen.findByText(
        'Changes could not be saved. They will last until this controller closes.',
      ),
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Open 1 shot' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('passes capture options through and reacts to progress and stop', async () => {
    let resolveCapture!: (result: CaptureJobResult) => void;
    runCaptureJobMock.mockImplementation((options: CaptureJobOptions) => {
      options.onShotUpdate?.({
        shotId: 'fixture-overview',
        status: 'capturing',
        currentUrl: 'http://localhost:5173/fixture/',
      });
      options.onProgress?.(1, 2);
      return new Promise((resolve) => {
        resolveCapture = resolve;
      });
    });
    render(App);

    await fireEvent.click(await screen.findByRole('button', { name: 'Open 2 shots' }));

    expect(runCaptureJobMock).toHaveBeenCalledOnce();
    const options = runCaptureJobMock.mock.calls[0]?.[0];
    if (!options) throw new Error('Capture options were not recorded.');
    expect(options.baseUrl).toBe('http://localhost:5173');
    expect(options.viewport.id).toBe('phone');
    expect(options.shots.map((shot) => shot.id)).toEqual(['fixture-overview', 'fixture-details']);
    expect(options.continueOnError).toBe(true);
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('Fixture overview').closest('tr')?.dataset.status).toBe('capturing');

    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
    await fireEvent.click(stop);
    expect(options.signal?.aborted).toBe(true);
    expect(stop.disabled).toBe(true);
    expect(screen.getByText('Stopping safely')).toBeTruthy();

    resolveCapture({
      completed: 0,
      failures: [],
      stopped: true,
      windowRetained: false,
    });
    expect(await screen.findByText('Stopped')).toBeTruthy();
  });

  it('renders capture failures and retries the previous run', async () => {
    runCaptureJobMock
      .mockImplementationOnce(async (options: CaptureJobOptions) => {
        options.onShotUpdate?.({
          shotId: 'fixture-details',
          status: 'failed',
          currentUrl: 'http://localhost:5173/fixture/?state=details',
          detail: 'Timed out.',
        });
        options.onProgress?.(2, 2);
        return {
          completed: 1,
          failures: [
            {
              shotId: 'fixture-details',
              currentUrl: 'http://localhost:5173/fixture/?state=details',
              message: 'Timed out.',
            },
          ],
          stopped: false,
          windowRetained: false,
        };
      })
      .mockResolvedValueOnce({
        completed: 2,
        failures: [],
        stopped: false,
        windowRetained: false,
      });
    render(App);

    await fireEvent.click(await screen.findByRole('button', { name: 'Open 2 shots' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('fixture-details: Timed out.');
    expect(screen.getByText('Fixture details').closest('tr')?.dataset.status).toBe('failed');

    await fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(runCaptureJobMock).toHaveBeenCalledTimes(2));
    expect(runCaptureJobMock.mock.calls[1]?.[0].shots.map((shot) => shot.id)).toEqual([
      'fixture-overview',
      'fixture-details',
    ]);
  });
  it('uses the QA default and preserves a customized Cubby URL', async () => {
    const view = render(App);
    const project = await screen.findByLabelText('Project');
    await fireEvent.change(project, { target: { value: 'cubby' } });
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'http://127.0.0.1:5174',
    );
    view.unmount();
    storageGetMock.mockResolvedValueOnce({
      'say-cheese-localhost.preferences.v1': {
        profileId: 'cubby',
        baseUrls: { cubby: 'http://127.0.0.1:5999' },
      },
    });
    render(App);
    const nextProject = await screen.findByLabelText('Project');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'http://127.0.0.1:5999',
    );
    await fireEvent.change(nextProject, { target: { value: 'cubby' } });
    await fireEvent.input(screen.getByLabelText('Base URL'), {
      target: { value: 'http://127.0.0.1:5999' },
    });
    await fireEvent.change(nextProject, { target: { value: 'local-demo' } });
    await fireEvent.change(nextProject, { target: { value: 'cubby' } });
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'http://127.0.0.1:5999',
    );
  });

  it('waits for the user to capture and permits another capture before moving on', async () => {
    runCaptureJobMock.mockImplementationOnce(async (options) => {
      const shot = options.shots[0]!;
      const first = await options.onManualReady!(shot, options.signal!);
      expect(first).toBe('capture');
      options.onShotUpdate?.({
        shotId: shot.id,
        status: 'complete',
        currentUrl: 'http://localhost:5173/detail',
      });
      const second = await options.onManualReady!(shot, options.signal!);
      expect(second).toBe('next');
      return { completed: 1, failures: [], stopped: false, windowRetained: false };
    });
    render(App);
    await fireEvent.click(await screen.findByRole('button', { name: 'Open 2 shots' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Capture current view' }));
    expect(await screen.findByText('Image saved. You can retake it or move on.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Next shot / finish' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Open 2 shots' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });
});
