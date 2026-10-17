import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listen: vi.fn(), prewarm: vi.fn(), start: vi.fn(), stop: vi.fn(),
  disconnect: vi.fn(), close: vi.fn(), log: vi.fn(),
}));
vi.mock('./app.js', () => ({ default: { listen: mocks.listen } }));
vi.mock('./config/env.js', () => ({ env: { PORT: 0, NODE_ENV: 'test' } }));
vi.mock('./lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.prewarm, $disconnect: mocks.disconnect } }));
vi.mock('./payment-inprocess-recovery.js', () => ({
  inProcessRecoveryEnabled: () => true, startInProcessRecovery: mocks.start,
}));
vi.mock('./utils/logger.js', () => ({
  logger: { info: mocks.log, error: mocks.log, warn: mocks.log },
  installFatalLogging: vi.fn(), flushLogsWithDeadline: vi.fn().mockResolvedValue(true),
}));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.start.mockReturnValue(mocks.stop);
  mocks.stop.mockResolvedValue(undefined);
  mocks.listen.mockReturnValue({ close: mocks.close });
});

it('starts the retrying recovery loop even when the first database prewarm fails', async () => {
  mocks.prewarm.mockRejectedValue(new Error('database offline at boot'));
  const originalInt = process.listeners('SIGINT'); const originalTerm = process.listeners('SIGTERM');
  try {
    await import('./server.js');
    await mocks.listen.mock.calls[0][1]();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.prewarm.mock.invocationCallOrder[0]);
  } finally {
    for (const [signal, previous] of [['SIGINT', originalInt], ['SIGTERM', originalTerm]] as const) {
      for (const listener of process.listeners(signal)) if (!previous.includes(listener)) process.removeListener(signal, listener);
    }
  }
});

it('drains the current recovery pass before disconnecting its database during shutdown', async () => {
  mocks.prewarm.mockResolvedValue(undefined);
  let drained!: () => void;
  mocks.stop.mockReturnValue(new Promise<void>(resolve => { drained = resolve; }));
  const originalInt = process.listeners('SIGINT'); const originalTerm = process.listeners('SIGTERM');
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  try {
    const module = await import('./server.js'); await mocks.listen.mock.calls[0][1]();
    module.gracefulShutdown('SIGTERM');
    const closing = mocks.close.mock.calls[0][0]();
    await Promise.resolve(); expect(mocks.disconnect).not.toHaveBeenCalled();
    drained(); await closing;
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(mocks.stop).toHaveBeenCalledOnce();
  } finally {
    exit.mockRestore();
    for (const [signal, previous] of [['SIGINT', originalInt], ['SIGTERM', originalTerm]] as const) {
      for (const listener of process.listeners(signal)) if (!previous.includes(listener)) process.removeListener(signal, listener);
    }
  }
});
