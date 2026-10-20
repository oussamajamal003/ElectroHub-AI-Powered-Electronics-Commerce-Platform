import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushLogs, logger } from '../src/utils/logger.js';
import { DurableLogTransport } from '../src/utils/logTransport.js';

const originalExitCode = process.exitCode;
const originalListeners = new Map(['uncaughtException', 'unhandledRejection'].map(event => [event, process.listeners(event)]));
afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers(); vi.doUnmock('../src/server.js');
  process.exitCode = originalExitCode;
  for (const [event, listeners] of originalListeners) for (const listener of process.listeners(event)) {
    if (!listeners.includes(listener)) process.removeListener(event, listener);
  }
});

describe('startup failure flush deadline', () => {
  it('terminates within two seconds when startup fails and the logging flush stalls', async () => {
    await flushLogs();
    vi.useFakeTimers();
    vi.spyOn(DurableLogTransport.prototype, 'flush').mockImplementation(() => new Promise(() => {}));
    const error = vi.spyOn(logger, 'error');
    const disconnect = vi.spyOn(process, 'disconnect').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.doMock('../src/server.js', () => { throw new Error('Synthetic startup import failure'); });
    await import('../src/bootstrap.js');
    await vi.dynamicImportSettled();
    expect(error).toHaveBeenCalledWith('Runtime initialization failed', expect.objectContaining({ operation: 'runtime.startup_failed' }));
    expect(disconnect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
