import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { StepUpDialog } from './components/StepUpDialog';

/** Thrown to the caller when the administrator closes the step-up dialog instead of verifying. */
export class StepUpCancelledError extends Error {
  constructor() {
    super('Verification was cancelled.');
    this.name = 'StepUpCancelledError';
  }
}
export const isStepUpCancelled = (error: unknown): error is StepUpCancelledError => error instanceof StepUpCancelledError;

/**
 * Runs a sensitive admin action. When the server answers STEP_UP_REQUIRED, the step-up dialog opens; once the administrator verifies,
 * the same action is retried. Closing the dialog rejects with StepUpCancelledError so the caller can stay quiet about it.
 * Render `dialog` once in the page that calls `runWithStepUp`.
 */
export function useStepUp(): { runWithStepUp: <T>(action: () => Promise<T>) => Promise<T>; dialog: ReactNode; verifying: boolean } {
  const [open, setOpen] = useState(false);
  const waiter = useRef<{ resolve: () => void; reject: (error: unknown) => void } | null>(null);

  const runWithStepUp = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'STEP_UP_REQUIRED') throw error;
    }
    await new Promise<void>((resolve, reject) => {
      waiter.current = { resolve, reject };
      setOpen(true);
    });
    return action();
  }, []);

  const settle = useCallback((verified: boolean) => {
    const pending = waiter.current;
    waiter.current = null;
    setOpen(false);
    if (!pending) return;
    if (verified) pending.resolve();
    else pending.reject(new StepUpCancelledError());
  }, []);

  const dialog = (
    <StepUpDialog
      open={open}
      onOpenChange={(next) => { if (!next) settle(false); }}
      onVerified={() => settle(true)}
    />
  );

  // `verifying`: the step-up dialog is open (callers keep optimistic UI back until the administrator has verified).
  return { runWithStepUp, dialog, verifying: open };
}
