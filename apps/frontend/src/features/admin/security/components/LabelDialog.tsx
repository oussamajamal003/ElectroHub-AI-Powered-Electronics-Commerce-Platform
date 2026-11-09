import { useEffect, useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import styles from './AdminSecurity.module.scss';

export interface LabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  pending?: boolean;
  error?: string | null;
  onSubmit: (value: string) => void;
}

/** Asks for a short name (authenticator app or passkey label). Empty and over-long names are rejected before any request. */
export function LabelDialog({ open, onOpenChange, title, description, label, initialValue, submitLabel, pending, error, onSubmit }: LabelDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setLocalError('');
    }
  }, [open, initialValue]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const trimmed = value.trim();
    if (!trimmed) { setLocalError('Enter a name.'); return; }
    if (trimmed.length > 60) { setLocalError('Use 60 characters or fewer.'); return; }
    setLocalError('');
    onSubmit(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className={styles.dialogBody}>
            <p className={styles.note}>{description}</p>
            {(error || localError) && <Alert variant="error">{error || localError}</Alert>}
            <form onSubmit={submit} noValidate className={styles.methodPanel}>
              <Input id="label-dialog-input" name="label" label={label} value={value} onChange={(e) => setValue(e.target.value)} maxLength={80}
                fullWidth disabled={pending} autoFocus autoComplete="off" />
              <div>
                <Button type="submit" isLoading={pending}>{submitLabel}</Button>
              </div>
            </form>
          </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
