import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageDiagnostics } from '../src/capture/diagnostics';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PageDiagnostics', () => {
  it('skips warning work for events that add no problem', () => {
    const warnings = vi.fn();
    const diagnostics = new PageDiagnostics(warnings);
    const stringify = vi.spyOn(JSON, 'stringify');
    for (let index = 0; index < 20; index += 1) {
      diagnostics.handle({ method: 'Network.dataReceived', params: { requestId: `r${index}` } });
    }
    expect(stringify).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();

    diagnostics.handle({ method: 'Runtime.exceptionThrown', params: {} });
    expect(warnings).toHaveBeenCalledOnce();
  });
});
