import { useId, useMemo, useState, type FormEvent, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Crown, ShieldCheck, UserCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput/PasswordInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';
import { adminSecurityApi, useOwnershipSuccessors, type AdminProfile, type OwnershipSuccessor } from '../api';
import { failureMessage, useEndAdminSession } from '../endAdminSession';
import { isStepUpCancelled, useStepUp } from '../useStepUp';
import pageStyles from '@/features/admin/shared/AdminPages.module.scss';

type Step = 'choose' | 'review' | 'confirm';
const STEPS: { id: Step; label: string }[] = [{ id: 'choose', label: 'Choose' }, { id: 'review', label: 'Review' }, { id: 'confirm', label: 'Confirm' }];

export const SUCCESSOR_INELIGIBLE_MESSAGE = 'This administrator is no longer eligible to become Owner. Choose another active administrator with two-step verification enabled.';
export const OWNER_STATE_CHANGED_MESSAGE = 'Administrator access changed while you were confirming. Review the current information and try again.';
const RESELECT_CODES = new Set(['SUCCESSOR_NOT_FOUND', 'SUCCESSOR_INACTIVE', 'SUCCESSOR_MFA_REQUIRED', 'SUCCESSOR_NOT_ELIGIBLE']);

const fullName = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`.trim();

/**
 * The last active Owner's exit: choose an eligible successor, review what changes, then confirm with the current password, typed DELETE
 * and an MFA step-up. One request; the server promotes and deletes in a single transaction, so nothing is reported before it commits.
 * The password lives only in this component's state and is cleared whenever the dialog closes.
 */
export function OwnershipTransferDialog({ profile, open, onOpenChange, returnFocus }: {
  profile: AdminProfile; open: boolean; onOpenChange: (open: boolean) => void; returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const endSession = useEndAdminSession();
  const navigate = useNavigate();
  const { runWithStepUp, dialog: stepUpDialog } = useStepUp();
  const successors = useOwnershipSuccessors(open);
  const [step, setStep] = useState<Step>('choose');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [reselect, setReselect] = useState(false);
  const [pending, setPending] = useState(false);
  const ids = { list: useId(), ack: useId() };

  const list = useMemo(() => successors.data ?? [], [successors.data]);
  const selected = list.find(item => item.id === selectedId) ?? null;
  const term = search.trim().toLowerCase();
  const visible = term ? list.filter(item => `${fullName(item)} ${item.email}`.toLowerCase().includes(term)) : list;
  const ready = Boolean(selected) && password.length > 0 && confirmation === 'DELETE' && acknowledged && !pending;
  const currentName = fullName(profile) || 'Your account';

  const reset = () => {
    setStep('choose'); setSearch(''); setSelectedId(null); setPassword(''); setPasswordError(''); setConfirmation('');
    setAcknowledged(false); setError(''); setReselect(false);
  };
  const changeOpen = (next: boolean) => {
    if (pending) return; // the request decides; closing mid-flight would hide its outcome
    if (!next) reset();
    onOpenChange(next);
  };
  const backToChoose = () => {
    setStep('choose'); setSelectedId(null); setAcknowledged(false); setError(''); setReselect(false);
    void successors.refetch();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !selected) return;
    setPending(true);
    setError('');
    setPasswordError('');
    setReselect(false);
    try {
      await runWithStepUp(() => adminSecurityApi.transferOwnershipAndDelete({ successorId: selected.id, currentPassword: password, confirmation: 'DELETE' }));
      // Reached only after the server committed both the transfer and the deletion; every session of this account has ended.
      endSession('OWNERSHIP_TRANSFERRED');
      return;
    } catch (failure) {
      if (isStepUpCancelled(failure)) setError('Nothing was changed. Confirm it is you to continue.');
      else if (failure instanceof ApiError && failure.code === 'INVALID_CURRENT_PASSWORD') setPasswordError(failure.message);
      else if (failure instanceof ApiError && failure.code && RESELECT_CODES.has(failure.code)) { setError(SUCCESSOR_INELIGIBLE_MESSAGE); setReselect(true); }
      else if (failure instanceof ApiError && failure.code === 'OWNER_STATE_CHANGED') { setError(OWNER_STATE_CHANGED_MESSAGE); setReselect(true); }
      else setError(failureMessage(failure, 'Ownership was not transferred and your account was not deleted. Try again.'));
    }
    setPending(false);
  };

  const stepIndex = STEPS.findIndex(item => item.id === step);

  return <>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className={`${pageStyles.dangerDialog} ${pageStyles.wizardDialog}`}
        onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <ol className={pageStyles.wizardSteps} aria-label="Ownership transfer progress">
          {STEPS.map((item, index) => <li key={item.id} className={index <= stepIndex ? pageStyles.wizardStepDone : undefined}
            aria-current={index === stepIndex ? 'step' : undefined}>
            <span aria-hidden="true">{index + 1}</span>{item.label}
          </li>)}
        </ol>

        {step === 'choose' && <>
          <DialogTitle className={pageStyles.dangerDialogTitle}><Crown aria-hidden="true" /> Choose the next Owner</DialogTitle>
          <DialogDescription>Select an existing administrator who will become responsible for managing ElectroHub after your account is deleted.</DialogDescription>
          {successors.isPending && <div className={pageStyles.successorList} aria-busy="true" aria-label="Loading eligible administrators">
            {[0, 1].map(index => <Skeleton key={index} className={pageStyles.successorSkeleton} />)}
          </div>}
          {successors.isError && <Alert variant="error">
            <AlertDescription>{failureMessage(successors.error, 'Eligible administrators could not be loaded.')}</AlertDescription>
            <Button type="button" size="small" variant="outline" onClick={() => void successors.refetch()}>Try again</Button>
          </Alert>}
          {successors.isSuccess && list.length === 0 && <>
            <Alert variant="warning">
              <AlertTitle>No eligible administrator is available</AlertTitle>
              <AlertDescription>Invite a new administrator or complete two-step verification for an existing administrator before transferring ownership.</AlertDescription>
            </Alert>
            <div className={`${pageStyles.formActions} ${pageStyles.formActionsStatic}`}>
              <Button type="button" variant="outline" onClick={() => changeOpen(false)}>Cancel</Button>
              <Button type="button" onClick={() => { changeOpen(false); navigate('/admin/settings/administrators'); }}>Manage Administrators</Button>
            </div>
          </>}
          {successors.isSuccess && list.length > 0 && <>
            {list.length > 3 && <Input id={`${ids.list}-search`} label="Search administrators" value={search} autoComplete="off"
              placeholder="Name or email" onChange={event => setSearch(event.target.value)} fullWidth />}
            <div role="radiogroup" aria-label="Eligible administrators" className={pageStyles.successorList}>
              {visible.map(item => <SuccessorOption key={item.id} item={item} group={ids.list} checked={item.id === selectedId}
                onSelect={() => setSelectedId(item.id)} />)}
              {visible.length === 0 && <p className={pageStyles.panelHint} role="status">No administrator matches “{search.trim()}”.</p>}
            </div>
            <div className={`${pageStyles.formActions} ${pageStyles.formActionsStatic}`}>
              <Button type="button" variant="outline" onClick={() => changeOpen(false)}>Cancel</Button>
              <Button type="button" disabled={!selected} onClick={() => setStep('review')}>Review transfer <ArrowRight aria-hidden="true" /></Button>
            </div>
          </>}
        </>}

        {step === 'review' && selected && <>
          <DialogTitle className={pageStyles.dangerDialogTitle}><UserCheck aria-hidden="true" /> Review Ownership Transfer</DialogTitle>
          <DialogDescription>Check who receives ownership and what happens to your account.</DialogDescription>
          <div className={pageStyles.transferPeople}>
            <div className={pageStyles.transferPerson}>
              <span className={pageStyles.transferRole}>Current Owner</span>
              <strong>{currentName}</strong><span>{profile.email}</span>
            </div>
            <ArrowRight aria-hidden="true" className={pageStyles.transferArrow} />
            <div className={`${pageStyles.transferPerson} ${pageStyles.transferPersonNew}`}>
              <span className={pageStyles.transferRole}>New Owner</span>
              <strong>{fullName(selected)}</strong><span>{selected.email}</span>
            </div>
          </div>
          <div className={pageStyles.transferColumns}>
            <section aria-labelledby={`${ids.list}-gains`}>
              <h3 id={`${ids.list}-gains`} className={pageStyles.transferHeading}>{selected.firstName || 'The new Owner'} will gain</h3>
              <ul className={pageStyles.dangerList}>
                <li>Full Owner capability.</li>
                <li>Authority to invite and manage administrators.</li>
                <li>Access to sensitive Owner-only operations, such as administrator access and two-step verification activation.</li>
                <li>Responsibility for future ownership changes.</li>
              </ul>
            </section>
            <section aria-labelledby={`${ids.list}-loses`}>
              <h3 id={`${ids.list}-loses`} className={pageStyles.transferHeading}>You will</h3>
              <ul className={pageStyles.dangerList}>
                <li>Lose all administrator access.</li>
                <li>Have every session signed out, on all devices.</li>
                <li>Be unable to sign in again.</li>
                <li>Have your name, email, password and sign-in methods removed.</li>
                <li>Keep your audit records and the order, inventory and delivery history you worked on, as required for accountability.</li>
              </ul>
            </section>
          </div>
          <p className={pageStyles.panelHint}>Orders, payments, passwords and two-step verification methods are not transferred. {selected.firstName || 'The new Owner'} signs in again with their own credentials.</p>
          <Alert variant="warning"><AlertDescription>This action permanently deletes your account and transfers the highest administrator authority to the selected person.</AlertDescription></Alert>
          <div className={`${pageStyles.formActions} ${pageStyles.formActionsStatic}`}>
            <Button type="button" variant="outline" onClick={() => setStep('choose')}><ArrowLeft aria-hidden="true" /> Back</Button>
            <Button type="button" onClick={() => setStep('confirm')}>Continue <ArrowRight aria-hidden="true" /></Button>
          </div>
        </>}

        {step === 'confirm' && selected && <>
          <DialogTitle className={pageStyles.dangerDialogTitle}><AlertTriangle aria-hidden="true" /> Confirm transfer and deletion</DialogTitle>
          <DialogDescription>
            <strong>{fullName(selected)}</strong> ({selected.email}) becomes Owner and <strong>{currentName}</strong> ({profile.email}) is deleted.
          </DialogDescription>
          {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription>
            {reselect && <Button type="button" size="small" variant="outline" onClick={backToChoose}>Choose another administrator</Button>}
          </Alert>}
          <form className={pageStyles.form} onSubmit={submit} onKeyDown={event => {
            if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement) || event.target.type === 'checkbox') return;
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }} noValidate aria-busy={pending || undefined}>
            <PasswordInput id="transfer-owner-password" label="Current password" autoComplete="current-password" value={password}
              onChange={event => { setPassword(event.target.value); setPasswordError(''); }} error={passwordError || undefined} fullWidth disabled={pending} />
            <Input id="transfer-owner-confirmation" label="Type DELETE to confirm" value={confirmation} autoComplete="off" spellCheck={false}
              onChange={event => setConfirmation(event.target.value)} fullWidth disabled={pending}
              helperText="You will also confirm it is you with two-step verification." />
            <div className={pageStyles.checkRow}>
              <Checkbox id={ids.ack} checked={acknowledged} onCheckedChange={value => setAcknowledged(value === true)} disabled={pending} />
              <label htmlFor={ids.ack}>I confirm that {fullName(selected)} becomes the Owner of ElectroHub.</label>
            </div>
            <div className={`${pageStyles.formActions} ${pageStyles.formActionsStatic}`}>
              <Button type="button" variant="outline" onClick={() => setStep('review')} disabled={pending}><ArrowLeft aria-hidden="true" /> Back</Button>
              <Button type="submit" variant="destructive" disabled={!ready} isLoading={pending}>Transfer Ownership &amp; Delete My Account</Button>
            </div>
          </form>
        </>}
      </DialogContent>
    </Dialog>
    {stepUpDialog}
  </>;
}

function SuccessorOption({ item, group, checked, onSelect }: { item: OwnershipSuccessor; group: string; checked: boolean; onSelect: () => void }) {
  const id = `${group}-${item.id}`;
  const methods = [item.mfa.totp > 0 && 'Authenticator app', item.mfa.passkeys > 0 && 'Passkey'].filter(Boolean).join(' · ');
  return <label htmlFor={id} className={`${pageStyles.successorCard} ${checked ? pageStyles.successorCardSelected : ''}`}>
    <input id={id} type="radio" name={group} value={item.id} checked={checked} onChange={onSelect} className={pageStyles.successorRadio} />
    <span className={pageStyles.successorBody}>
      <strong>{fullName(item)}</strong>
      <span className={pageStyles.successorEmail}>{item.email}</span>
      <span className={pageStyles.tags}>
        <Badge size="sm" variant="success">Active</Badge>
        <Badge size="sm" variant="info" icon={<ShieldCheck aria-hidden="true" />}>Two-step verification on</Badge>
        <Badge size="sm" variant="neutral">{item.canManageAdmins ? 'Can manage administrators' : 'Administrator'}</Badge>
      </span>
      {methods && <span className={pageStyles.successorMethods}>{methods}</span>}
    </span>
  </label>;
}
