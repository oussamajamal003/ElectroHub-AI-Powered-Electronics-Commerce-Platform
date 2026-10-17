import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { prewarmDatabase, gracefulShutdown, server } from '../src/server.js';
import { logger } from '../src/utils/logger.js';

describe('Server Startup Prewarming & Readiness Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prewarmDatabase returns true and logs db.ready when query succeeds', async () => {
    const querySpy = vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ '?column?': 1 }]);
    const loggerSpy = vi.spyOn(logger, 'info');

    const result = await prewarmDatabase();

    expect(result).toBe(true);
    expect(querySpy).toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith(
      'Database connection established and pool pre-warmed.',
      expect.objectContaining({ event: 'db.ready' })
    );

    querySpy.mockRestore();
    loggerSpy.mockRestore();
  });

  it('prewarmDatabase returns false and handles rejection cleanly during DB outage', async () => {
    const querySpy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
    const loggerSpy = vi.spyOn(logger, 'error');

    const result = await prewarmDatabase();

    expect(result).toBe(false);
    expect(loggerSpy).toHaveBeenCalledWith(
      'Database connection failed during startup pre-warm.',
      expect.objectContaining({ event: 'db.unavailable', error: 'Connection terminated unexpectedly' })
    );

    querySpy.mockRestore();
    loggerSpy.mockRestore();
  });
});

describe('Graceful Shutdown Lifecycle', () => {
  it('closes HTTP server and cleanly disconnects Prisma client', async () => {
    const disconnectSpy = vi.spyOn(prisma, '$disconnect').mockResolvedValueOnce();
    const serverCloseSpy = vi.spyOn(server, 'close').mockImplementationOnce((cb?: (err?: Error) => void) => {
      if (cb) cb();
      return server;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementationOnce((() => undefined) as never);
    const loggerInfoSpy = vi.spyOn(logger, 'info');

    gracefulShutdown('SIGTERM');

    // Wait microtask tick for async callbacks in server.close
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(serverCloseSpy).toHaveBeenCalled();
    expect(disconnectSpy).toHaveBeenCalled();
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      'Database connection pool closed cleanly.',
      expect.objectContaining({ event: 'db.disconnected' })
    );

    disconnectSpy.mockRestore();
    serverCloseSpy.mockRestore();
    exitSpy.mockRestore();
    loggerInfoSpy.mockRestore();
  });
});
