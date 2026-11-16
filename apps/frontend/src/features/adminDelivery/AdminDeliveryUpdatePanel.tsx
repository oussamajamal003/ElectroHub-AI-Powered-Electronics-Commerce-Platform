import { useId, useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { AdminForm, AdminFormActions, AdminFormContent, AdminFormHeader, AdminFormTitle } from '@/components/ui/AdminForm';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import { formatStamp, stageOf } from '@/features/delivery/presentation';
import { useAdminDeliveryMutations } from '@/features/delivery/queries';
import type { AdminDeliverySnapshot, AdminDeliveryUpdate } from '@/features/delivery/types';
import styles from './AdminDeliveryUpdatePanel.module.scss';

const KEEP = 'KEEP';
const ETA_FUTURE_DAYS = 30;
type Form = { status: string; latitude: string; longitude: string; label: string; clearLocation: boolean; eta: string; clearEta: boolean; note: string };
const EMPTY: Form = { status: KEEP, latitude: '', longitude: '', label: '', clearLocation: false, eta: '', clearEta: false, note: '' };

/** `datetime-local` value (viewer's zone) ↔ ISO instant. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/**
 * Task 04.5 admin update form (handoff §7, §9.3). Only the next forward status is offered; location fields appear only for
 * OUT_FOR_DELIVERY. Every change is reviewed in a confirm dialog and sent with the loaded revision, so a concurrent edit by another
 * administrator is reported, never silently overwritten.
 */
export function AdminDeliveryUpdatePanel({ snapshot, onLoadLatest }: { snapshot: AdminDeliverySnapshot; onLoadLatest: () => Promise<unknown> }) {
  const formId = useId();
  const { start, update } = useAdminDeliveryMutations(snapshot.orderReference);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [review, setReview] = useState<{ body: AdminDeliveryUpdate; lines: string[] } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const current = snapshot.current;
  const resulting = form.status === KEEP ? snapshot.status : form.status;
  const conflict = update.error instanceof ApiError && update.error.code === 'DELIVERY_REVISION_CONFLICT';
  const set = <K extends keyof Form>(key: K, value: Form[K]) => { setForm(previous => ({ ...previous, [key]: value })); setSaved(null); };

  if (!snapshot.paymentEligible) return <Alert variant="warning"><span>{snapshot.status === 'CANCELLED'
    ? 'This order was cancelled. Its delivery can no longer change.' : 'Delivery tracking needs a confirmed successful payment for this order.'}</span></Alert>;

  if (snapshot.canStart) return <section className={styles.panel} aria-labelledby={`${formId}-start`}>
    <h2 id={`${formId}-start`}>Start tracking</h2>
    <p>Creates the delivery record with a tracking reference and one “Tracking started” event at the order’s current status
      ({stageOf(snapshot.status).label}). Earlier steps are not back-filled.</p>
    {start.isError && <Alert variant="error"><span>{start.error instanceof ApiError ? start.error.message : 'Tracking could not be started. Please retry.'}</span></Alert>}
    <Button type="button" onClick={() => start.mutate()} isLoading={start.isPending} disabled={start.isPending}>Start tracking</Button>
  </section>;

  if (!current || !snapshot.allowedNextStatus) return <Alert variant="success"><span>This order has been delivered. Its tracking is complete and can no longer change.</span></Alert>;

  const validate = () => {
    const next: typeof errors = {};
    const body: AdminDeliveryUpdate = { expectedRevision: current.revision };
    const lines: string[] = [];
    if (form.status !== KEEP) { body.status = form.status as AdminDeliveryUpdate['status']; lines.push(`Status: ${stageOf(snapshot.status).label} → ${stageOf(form.status).label}`); }
    if (resulting === 'OUT_FOR_DELIVERY') {
      if (form.clearLocation) { if (current.location) { body.location = null; lines.push('Location: cleared'); } }
      else if (form.latitude.trim() || form.longitude.trim()) {
        const latitude = Number(form.latitude), longitude = Number(form.longitude);
        if (!form.latitude.trim() || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) next.latitude = 'Enter a latitude between -90 and 90.';
        if (!form.longitude.trim() || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) next.longitude = 'Enter a longitude between -180 and 180.';
        if (form.label.trim().length > 80) next.label = 'Use 80 characters or fewer.';
        if (!next.latitude && !next.longitude && !next.label) {
          body.location = { latitude, longitude, label: form.label.trim() || null };
          lines.push(`Location: ${form.label.trim() || 'unlabelled position'} (${latitude}, ${longitude})`);
        }
      }
    }
    if (resulting !== 'DELIVERED') {
      if (form.clearEta) { if (current.estimatedAt) { body.estimatedAt = null; lines.push('Estimated arrival: cleared'); } }
      else if (form.eta) {
        const time = new Date(form.eta).getTime();
        if (!Number.isFinite(time) || time < Date.now() - 5 * 60_000 || time > Date.now() + ETA_FUTURE_DAYS * 86_400_000) next.eta = 'Choose a time between now and 30 days from now.';
        else { body.estimatedAt = new Date(time).toISOString(); lines.push(`Estimated arrival: ${formatStamp(body.estimatedAt)}`); }
      }
    }
    if (form.note.trim().length > 280) next.note = 'Use 280 characters or fewer.';
    else if (form.note.trim()) body.note = form.note.trim();
    setErrors(next);
    if (Object.keys(next).length) return null;
    if (!lines.length) { setErrors({ status: 'Change the status, location or estimated arrival before reviewing.' }); return null; }
    return { body, lines };
  };

  const submit = (event: FormEvent) => { event.preventDefault(); update.reset(); const result = validate(); if (result) setReview(result); };
  const confirm = () => {
    if (!review) return;
    update.mutate(review.body, {
      onSuccess: response => { setForm(EMPTY); setSaved(response.meta.changed ? `Update saved. Revision ${response.data.current?.revision}.` : 'Nothing changed; no update was recorded.'); },
      onSettled: () => setReview(null),
    });
  };
  const statusOptions = [{ value: KEEP, label: `No status change (${stageOf(snapshot.status).label})` },
    { value: snapshot.allowedNextStatus, label: `Move to ${stageOf(snapshot.allowedNextStatus).label}` }];

  return <>
    <AdminForm className={styles.panel} onSubmit={submit} aria-labelledby={`${formId}-title`} noValidate>
      <AdminFormHeader><AdminFormTitle id={`${formId}-title`}>Update delivery</AdminFormTitle>
        <p className={styles.help}>Revision {current.revision}. Only the next step is allowed; changes are recorded as one event.</p></AdminFormHeader>
      <AdminFormContent className={styles.content}>
        {saved && <Alert variant="success" role="status"><span>{saved}</span></Alert>}
        {conflict && <Alert variant="warning" role="alert"><span>Another administrator updated this delivery after you loaded it. Load the latest version and review your change again.</span>{' '}
          <Button type="button" size="small" variant="outline" onClick={() => { update.reset(); setForm(EMPTY); void onLoadLatest(); }}>Load latest</Button></Alert>}
        {update.isError && !conflict && <Alert variant="error" role="alert"><span>{update.error instanceof ApiError ? update.error.message : 'The update could not be saved. Please retry.'}</span></Alert>}
        <Select label="Next status" options={statusOptions} value={form.status} onValueChange={value => set('status', value)} error={errors.status} fullWidth />
        {resulting === 'OUT_FOR_DELIVERY' && <fieldset className={styles.fieldset}>
          <legend>Courier location</legend>
          <p className={styles.help}>Shown to the customer as text. Use a place name, never a customer’s personal details.</p>
          <div className={styles.pair}>
            <Input label="Latitude" inputMode="decimal" value={form.latitude} onChange={event => set('latitude', event.target.value)} error={errors.latitude} disabled={form.clearLocation} fullWidth />
            <Input label="Longitude" inputMode="decimal" value={form.longitude} onChange={event => set('longitude', event.target.value)} error={errors.longitude} disabled={form.clearLocation} fullWidth />
          </div>
          <Input label="Location label (optional)" maxLength={80} value={form.label} onChange={event => set('label', event.target.value)} error={errors.label} disabled={form.clearLocation} fullWidth />
          {current.location && <label className={styles.check}><input type="checkbox" checked={form.clearLocation} onChange={event => set('clearLocation', event.target.checked)} />Clear the current location</label>}
        </fieldset>}
        {resulting !== 'DELIVERED' && <fieldset className={styles.fieldset}>
          <legend>Estimated arrival</legend>
          <Input label="Date and time (your time zone)" type="datetime-local" value={form.eta} min={toLocalInput(new Date().toISOString())}
            onChange={event => set('eta', event.target.value)} error={errors.eta} disabled={form.clearEta} fullWidth />
          {current.estimatedAt && <label className={styles.check}><input type="checkbox" checked={form.clearEta} onChange={event => set('clearEta', event.target.checked)} />Clear the current estimate</label>}
        </fieldset>}
        <Textarea label="Internal note (optional)" helperText="Admins only. Never shown to the customer." maxLength={280} value={form.note}
          onChange={event => set('note', event.target.value)} error={errors.note} fullWidth />
      </AdminFormContent>
      <AdminFormActions><Button ref={reviewButton} type="submit" disabled={update.isPending}>Review update</Button></AdminFormActions>
    </AdminForm>
    <Dialog open={review !== null} onOpenChange={open => { if (!open && !update.isPending) setReview(null); }}>
      {/* Controlled without a Trigger, so focus is returned to Review update explicitly when the dialog closes. */}
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); reviewButton.current?.focus(); }}>
        <DialogTitle>Confirm delivery update</DialogTitle>
        <DialogDescription>{snapshot.orderReference} · revision {current.revision} → {current.revision + 1}</DialogDescription>
        <ul className={styles.changes}>{review?.lines.map(line => <li key={line}>{line}</li>)}</ul>
        {review?.body.status === 'DELIVERED' && <p className={styles.warning}>Delivered is final. This can’t be undone.</p>}
        <div className={styles.dialogActions}>
          <Button type="button" variant="outline" onClick={() => setReview(null)} disabled={update.isPending}>Cancel</Button>
          <Button type="button" onClick={confirm} isLoading={update.isPending} disabled={update.isPending}>Confirm update</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
