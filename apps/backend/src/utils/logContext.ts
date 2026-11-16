import { AsyncLocalStorage } from 'node:async_hooks';

export const logContext = new AsyncLocalStorage<{ requestId: string; workerInstanceId?: string }>();
