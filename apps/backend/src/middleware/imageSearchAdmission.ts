import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errorHandler.js';
import { recordImageSearchLifecycle, type ImageSearchOutcome } from '../integrations/ai/image-search.telemetry.js';

export const IMAGE_SEARCH_ADMISSION = { maxConcurrent: 4, uploadTimeoutMs: 10_000, requestTimeoutMs: 25_000 } as const;
interface Lifecycle {
  signal: AbortSignal;
  stopped: boolean;
  parsed: () => void;
  outcome?: ImageSearchOutcome;
  modelVersion?: string;
  embeddingVersion?: string;
  resultCount?: number;
}
const lifecycle = new WeakMap<Request, Lifecycle>();
export const imageSearchLifecycle = (req: Request) => lifecycle.get(req);

/** Slots cover upload AND downstream work, bounding retained photo buffers; timers are local to this route. */
export function createImageSearchAdmission(options: { maxConcurrent?: number; uploadTimeoutMs?: number; requestTimeoutMs?: number } = {}) {
  const budget = { ...IMAGE_SEARCH_ADMISSION, ...options };
  for (const [key, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid image search admission ${key}`);
  }
  let active = 0;
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = Date.now();
    if (active >= budget.maxConcurrent) {
      recordImageSearchLifecycle({ outcome: 'busy', requestId: req.id, activeRequests: active, durationMs: 0, statusCode: 429 });
      res.setHeader('Retry-After', '1');
      res.setHeader('Connection', 'close');
      res.once('finish', () => { if (!req.complete) req.destroy(); });
      next(new AppError('Photo search is busy. Please try again shortly.', 429, 'IMAGE_UPLOAD_BUSY'));
      return;
    }
    active += 1;
    let released = false;
    let uploadDurationMs: number | undefined;
    const abort = new AbortController();
    const state: Lifecycle = {
      signal: abort.signal, stopped: false,
      parsed: () => {
        if (state.stopped || uploadDurationMs !== undefined) return;
        uploadDurationMs = Date.now() - started;
        clearTimeout(uploadTimer);
        recordImageSearchLifecycle({ outcome: 'parsed', requestId: req.id, uploadDurationMs, activeRequests: active });
      },
    };
    lifecycle.set(req, state);
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
      state.stopped = true;
      abort.abort();
      clearTimeout(uploadTimer); clearTimeout(requestTimer);
      req.off('aborted', onDisconnect); req.off('error', onRequestError);
      res.off('finish', onFinish); res.off('close', onClose);
      delete req.file;
      delete res.locals.sniffedImage;
      lifecycle.delete(req);
      recordImageSearchLifecycle({ outcome: state.outcome ?? (res.statusCode < 400 ? 'completed' : 'failed'),
        requestId: req.id, uploadDurationMs: uploadDurationMs ?? Date.now() - started, durationMs: Date.now() - started,
        statusCode: state.outcome === 'disconnected' ? undefined : res.statusCode,
        activeRequests: active, resultCount: state.resultCount, modelVersion: state.modelVersion, embeddingVersion: state.embeddingVersion });
    };
    const onDisconnect = () => { state.outcome = 'disconnected'; release(); };
    const onRequestError = () => { if (!state.stopped) { state.outcome = 'parse_failed'; release(); } };
    const onFinish = () => { release(); if (!req.complete) req.destroy(); };
    const onClose = () => { if (!res.writableFinished) state.outcome = 'disconnected'; release(); };
    const expire = (outcome: 'upload_timeout' | 'request_timeout') => {
      if (released) return;
      state.stopped = true;
      state.outcome = outcome;
      abort.abort();
      const error = outcome === 'upload_timeout'
        ? new AppError('Photo upload took too long. Please try again.', 408, 'IMAGE_UPLOAD_TIMEOUT')
        : new AppError('Photo search took too long. Please try again.', 504, 'IMAGE_SEARCH_REQUEST_TIMEOUT');
      // Stop Multer/Busboy and their buffers. Our terminal flag suppresses their late callback.
      req.emit('error', error);
      if (!res.headersSent) { res.setHeader('Connection', 'close'); next(error); }
      else { res.destroy(); release(); }
    };
    const uploadTimer = setTimeout(() => expire('upload_timeout'), budget.uploadTimeoutMs);
    const requestTimer = setTimeout(() => expire('request_timeout'), budget.requestTimeoutMs);
    uploadTimer.unref(); requestTimer.unref();
    req.once('aborted', onDisconnect); req.on('error', onRequestError);
    res.once('finish', onFinish); res.once('close', onClose);
    recordImageSearchLifecycle({ outcome: 'admitted', requestId: req.id, activeRequests: active });
    next();
  };
}

export const imageSearchAdmission = createImageSearchAdmission();
