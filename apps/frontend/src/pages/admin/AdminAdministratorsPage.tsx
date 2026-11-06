import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { Checkbox } from '@/components/ui/Checkbox';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { ApiError } from '@/lib/api';
import {
  useAdminProfile, useAdministrators, useCreateInvitation, useInvitations, useRequestActivation, useResendActivation, useResendInvitation,
  useRevokeActivation, useRevokeInvitation,
  useUpdateAdministratorAccess, type AdminInvitation, type AdministratorSummary, type InvitationDelivery, type InvitationStatus,
} from '@/features/admin/security/api';
import { teamFailure } from './teamFailure';
import { useStepUp } from '@/features/admin/security/useStepUp';
import { twoStepStatus } from '@/features/admin/security/twoStepStatus';
import {
  ConfirmDialog, EmptyRows, ListEmpty, PageHeader, Pager, QueryProblem, StatusPill, TableCard, useAdminToast,
} from '@/features/admin/shared/AdminUi';
import { formatDate, formatDateTime } from '@/features/admin/shared/format';
import styles from '@/features/admin/shared/AdminPages.module.scss';
import secStyles from './AdminSecurityPage.module.scss';

const INVITATION_STATUS_OPTIONS: { value: InvitationStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'REVOKED', label: 'Revoked' },
];

const INVITATION_LABELS: Record<InvitationStatus, { label: string; tone: 'info' | 'success' | 'warning' | 'neutral' }> = {
  PENDING: { label: 'Awaiting acceptance', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
  REVOKED: { label: 'Revoked', tone: 'neutral' },
};

const DELIVERY_LABELS: Record<InvitationDelivery, string> = {
  PENDING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Delivery failed',
};

interface PendingAccessChange {
  row: AdministratorSummary;
  field: 'isActive' | 'canManageAdmins';
  value: boolean;
}

export function AdminAdministratorsPage() {
  const profile = useAdminProfile();
  const capabilities = profile.data?.capabilities;
  const canManage = capabilities?.canManageAdmins ?? false;
  const isOwner = capabilities?.isOwner ?? false;
  const toast = useAdminToast();
  const { runWithStepUp, dialog: stepUpDialog } = useStepUp();

  const [adminPage, setAdminPage] = useState(1);
  const [invitePage, setInvitePage] = useState(1);
  const [inviteStatus, setInviteStatus] = useState<InvitationStatus>('PENDING');
  const administrators = useAdministrators(adminPage);
  const invitations = useInvitations(inviteStatus, invitePage);
  const updateAccess = useUpdateAdministratorAccess();
  const createInvitation = useCreateInvitation();
  const resendInvitation = useResendInvitation();
  const revokeInvitation = useRevokeInvitation();
  const requestActivation = useRequestActivation();
  const resendActivation = useResendActivation();
  const revokeActivation = useRevokeActivation();

  const [accessChange, setAccessChange] = useState<PendingAccessChange | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AdminInvitation | null>(null);
  const [activateTarget, setActivateTarget] = useState<AdministratorSummary | null>(null);
  // The dialog is opened from a table button, not a Radix trigger, so the opener is remembered to hand focus back on close.
  const activateOpener = useRef<HTMLElement | null>(null);
  const [revokeActivationTarget, setRevokeActivationTarget] = useState<AdministratorSummary | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteManage, setInviteManage] = useState(false);
  const [inviteFieldError, setInviteFieldError] = useState('');

  const readOnly = administrators.error instanceof ApiError && administrators.error.code === 'CAPABILITY_REQUIRED';

  const runAccessChange = async (change: PendingAccessChange) => {
    setRowError(null);
    setBusy(true);
    setDialogError(null);
    try {
      await runWithStepUp(() => updateAccess.mutateAsync({ id: change.row.id, body: change.field === 'isActive' ? { isActive: change.value } : { canManageAdmins: change.value } }));
      setAccessChange(null);
      toast('Access updated.');
    } catch (error) {
      const message = teamFailure(error);
      if (accessChange) setDialogError(message);
      else if (message) setRowError(message);
    } finally {
      setBusy(false);
    }
  };

  /** Turning access off asks first; turning it on applies straight away. Both still pass through step-up. */
  const requestAccessChange = (change: PendingAccessChange) => {
    if (change.value === false) {
      setDialogError(null);
      setAccessChange(change);
      return;
    }
    void runAccessChange(change);
  };

  const openInvite = () => {
    setInviteEmail('');
    setInviteManage(false);
    setInviteFieldError('');
    setDialogError(null);
    setInviteOpen(true);
  };

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const email = inviteEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteFieldError('Enter a valid email address.');
      return;
    }
    setInviteFieldError('');
    setBusy(true);
    setDialogError(null);
    try {
      await runWithStepUp(() => createInvitation.mutateAsync({ email, grantManageAdmins: inviteManage }));
      setInviteOpen(false);
      toast('Invitation sent.');
    } catch (error) {
      const message = teamFailure(error);
      if (message) setDialogError(message);
    } finally {
      setBusy(false);
    }
  };

  const doResend = async (invitation: AdminInvitation) => {
    setRowError(null);
    try {
      await runWithStepUp(() => resendInvitation.mutateAsync(invitation.id));
      toast('Invitation sent again.');
    } catch (error) {
      const message = teamFailure(error);
      if (message) setRowError(message);
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    setBusy(true);
    setDialogError(null);
    try {
      await runWithStepUp(() => revokeInvitation.mutateAsync(revokeTarget.id));
      setRevokeTarget(null);
      toast('Invitation revoked.');
    } catch (error) {
      const message = teamFailure(error);
      if (message) setDialogError(message);
    } finally {
      setBusy(false);
    }
  };

  const confirmActivation = async () => {
    if (!activateTarget || busy) return;
    setBusy(true);
    setDialogError(null);
    try {
      const activation = await runWithStepUp(() => requestActivation.mutateAsync(activateTarget.id));
      setActivateTarget(null);
      if (activation.deliveryStatus === 'FAILED') setRowError(`The activation link for ${activateTarget.email} was created but the email could not be delivered. Use Resend to retry.`);
      else toast('Activation link sent.');
    } catch (error) {
      const message = teamFailure(error);
      if (message) setDialogError(message);
    } finally {
      setBusy(false);
    }
  };

  const doResendActivation = async (row: AdministratorSummary) => {
    setRowError(null);
    try {
      const activation = await runWithStepUp(() => resendActivation.mutateAsync(row.id));
      if (activation.deliveryStatus === 'FAILED') setRowError(`The activation link for ${row.email} could not be delivered. Try again shortly.`);
      else toast('Activation link sent again.');
    } catch (error) {
      const message = teamFailure(error);
      if (message) setRowError(message);
    }
  };

  const confirmRevokeActivation = async () => {
    if (!revokeActivationTarget) return;
    setBusy(true);
    setDialogError(null);
    try {
      await runWithStepUp(() => revokeActivation.mutateAsync(revokeActivationTarget.id));
      setRevokeActivationTarget(null);
      toast('Activation revoked.');
    } catch (error) {
      const message = teamFailure(error);
      if (message) setDialogError(message);
    } finally {
      setBusy(false);
    }
  };

  const adminColumns: Column<AdministratorSummary>[] = [
    { key: 'name', title: 'Administrator', render: row => <span className={styles.cellText}>
      <strong>{`${row.firstName} ${row.lastName}`.trim() || row.email}</strong>
      <span>{row.email}</span>
    </span> },
    { key: 'role', title: 'Role', render: row => <span className={styles.tags}>
      {row.isOwner && <StatusPill tone="primary" icon={false}>Owner</StatusPill>}
      {row.canManageAdmins && !row.isOwner && <StatusPill tone="info" icon={false}>Manages admins</StatusPill>}
      {!row.isOwner && !row.canManageAdmins && <span className={styles.muted}>Administrator</span>}
      {row.isSelf && <StatusPill tone="neutral" icon={false}>You</StatusPill>}
    </span> },
    { key: 'mfa', title: 'Two-step', render: row => {
      const status = twoStepStatus(row);
      return <span className={styles.cellText}>
        <StatusPill tone={status.tone}>{row.mfaEnrolled ? 'Two-step verification enabled' : status.label}</StatusPill>
        {status.detail && <span>{status.detail}</span>}
        {isOwner && !row.isSelf && (status.action !== 'none' || status.canRevoke) && <span className={styles.rowActions}>
          {status.action === 'activate' && <Button type="button" variant="outline" size="small" disabled={busy}
            onClick={(event) => { activateOpener.current = event.currentTarget; setDialogError(null); setActivateTarget(row); }} aria-label={`Activate account for ${row.email}`}>Activate account</Button>}
          {status.action === 'resend' && <Button type="button" variant="outline" size="small" disabled={busy}
            onClick={() => void doResendActivation(row)} aria-label={`Resend activation link to ${row.email}`}>Resend</Button>}
          {status.canRevoke && <Button type="button" variant="outline" size="small" disabled={busy}
            onClick={() => { setDialogError(null); setRevokeActivationTarget(row); }} aria-label={`Revoke activation for ${row.email}`}>Revoke</Button>}
        </span>}
      </span>;
    } },
    { key: 'lastLogin', title: 'Last sign-in', render: row => row.lastLoginAt ? formatDateTime(row.lastLoginAt) : 'Never' },
    { key: 'active', title: 'Active', render: row => isOwner
      ? <Switch aria-label={`Active access for ${row.email}`} checked={row.isActive} disabled={row.isSelf || busy}
        onCheckedChange={(value) => requestAccessChange({ row, field: 'isActive', value })} />
      : (row.isActive ? <StatusPill tone="success">Active</StatusPill> : <StatusPill tone="neutral">Inactive</StatusPill>) },
    { key: 'manage', title: 'Manages admins', render: row => isOwner
      ? <Switch aria-label={`Manage administrators for ${row.email}`} checked={row.canManageAdmins} disabled={row.isSelf || row.isOwner || busy}
        onCheckedChange={(value) => requestAccessChange({ row, field: 'canManageAdmins', value })} />
      : (row.canManageAdmins ? 'Yes' : 'No') },
  ];

  const invitationColumns: Column<AdminInvitation>[] = [
    { key: 'email', title: 'Invitee', render: row => <span className={styles.cellText}>
      <strong>{row.email}</strong>
      <span>{row.grantManageAdmins ? 'Will manage administrators' : 'Administrator'}</span>
    </span> },
    { key: 'status', title: 'Status', render: row => <StatusPill tone={INVITATION_LABELS[row.status].tone} icon={false}>{INVITATION_LABELS[row.status].label}</StatusPill> },
    { key: 'delivery', title: 'Email', render: row => row.deliveryStatus === 'FAILED'
      ? <StatusPill tone="error">{DELIVERY_LABELS.FAILED}</StatusPill>
      : DELIVERY_LABELS[row.deliveryStatus] },
    { key: 'expires', title: 'Expires', render: row => formatDate(row.expiresAt) },
    { key: 'actions', title: '', align: 'right', render: row => <span className={styles.rowActions}>
      {canManage && (row.status === 'PENDING' || row.status === 'EXPIRED') && <Button type="button" variant="outline" size="small"
        onClick={() => void doResend(row)} disabled={busy} aria-label={`Resend invitation to ${row.email}`}>Resend</Button>}
      {canManage && row.status === 'PENDING' && <Button type="button" variant="outline" size="small"
        onClick={() => { setDialogError(null); setRevokeTarget(row); }} disabled={busy} aria-label={`Revoke invitation to ${row.email}`}>Revoke</Button>}
    </span> },
  ];

  if (profile.isPending) {
    return <div className={styles.page}>
      <PageHeader title="Administrators" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Settings', to: '/admin/settings' }, { label: 'Administrators' }]}
        description="Who can use the admin console, and invitations for new administrators." />
      <div role="status" aria-label="Loading administrators" aria-busy="true">
        <TableCard busy label="Administrators">
          <DataTable<AdministratorSummary> caption="Administrators" data={[]} columns={adminColumns} keyExtractor={row => row.id} loadingRows={4} />
        </TableCard>
      </div>
    </div>;
  }

  return <div className={styles.page}>
    <PageHeader title="Administrators" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Settings', to: '/admin/settings' }, { label: 'Administrators' }]}
      description="Who can use the admin console, and invitations for new administrators."
      actions={canManage && !readOnly ? <Button type="button" onClick={openInvite}>Invite administrator</Button> : undefined} />

    {readOnly && <Alert variant="info">
      You can see the administrator team, but changing it needs administrator management access. <Link className={styles.panelLink} to="/admin/profile">Back to your profile</Link>
    </Alert>}
    {rowError && <Alert variant="error">{rowError}</Alert>}

    {administrators.isError && !readOnly && !administrators.data && <QueryProblem error={administrators.error} hasData={false}
      onRetry={() => void administrators.refetch()} retrying={administrators.isFetching} what="The administrator list" />}
    <section className={styles.panelFlush} aria-labelledby="team-admins-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="team-admins-title" className={styles.panelTitle}>Administrators</h2>
          <p className={styles.panelHint}>
            {isOwner ? 'As an owner you can turn access on or off. You cannot change your own access here.'
              : 'Only owners can change access. Ask an owner if access needs to change.'}
          </p>
        </div>
      </div>
      {readOnly ? null : <>
        <TableCard busy={administrators.isPlaceholderData} label="Administrators">
          <DataTable caption="Administrators" data={administrators.data?.data ?? []} columns={adminColumns} keyExtractor={row => row.id}
            loadingRows={administrators.isPending ? 4 : undefined}
            emptyMessage={<ListEmpty failed={administrators.isError && !administrators.data}>
              <EmptyRows title="No administrators to show" />
            </ListEmpty>} />
        </TableCard>
        <Pager meta={administrators.data?.meta} onPage={setAdminPage} disabled={administrators.isPlaceholderData} label="Administrator pages" />
      </>}
    </section>

    {canManage && !readOnly && <section className={styles.panelFlush} aria-labelledby="team-invites-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="team-invites-title" className={styles.panelTitle}>Invitations</h2>
          <p className={styles.panelHint}>Invitations expire. Resend one if the invitee did not receive it.</p>
        </div>
        <Select label="Status" selectSize="small" value={inviteStatus} options={INVITATION_STATUS_OPTIONS}
          onValueChange={(value) => { setInviteStatus(value as InvitationStatus); setInvitePage(1); }} />
      </div>
      {invitations.isError && !invitations.data && <QueryProblem error={invitations.error} hasData={false}
        onRetry={() => void invitations.refetch()} retrying={invitations.isFetching} what="Invitations" />}
      <TableCard busy={invitations.isPlaceholderData} label="Invitations">
        <DataTable caption="Invitations" data={invitations.data?.data ?? []} columns={invitationColumns} keyExtractor={row => row.id}
          loadingRows={invitations.isPending ? 3 : undefined}
          emptyMessage={<ListEmpty failed={invitations.isError && !invitations.data}>
            <EmptyRows title="No invitations here" hint="Invite an administrator to add them to the team." />
          </ListEmpty>} />
      </TableCard>
      <Pager meta={invitations.data?.meta} onPage={setInvitePage} disabled={invitations.isPlaceholderData} label="Invitation pages" />
    </section>}

    <ConfirmDialog open={accessChange !== null} onOpenChange={(next) => { if (!next && !busy) setAccessChange(null); }}
      title={accessChange?.field === 'isActive' ? 'Deactivate this administrator?' : 'Remove management access?'}
      description={accessChange?.field === 'isActive'
        ? `${accessChange.row.email} will be signed out and cannot use the admin console until reactivated.`
        : `${accessChange?.row.email ?? 'This administrator'} will no longer be able to invite or change administrators.`}
      confirmLabel={accessChange?.field === 'isActive' ? 'Deactivate' : 'Remove access'} destructive pending={busy} error={dialogError}
      onConfirm={() => { if (accessChange) void runAccessChange(accessChange); }} />

    <ConfirmDialog open={revokeTarget !== null} onOpenChange={(next) => { if (!next && !busy) setRevokeTarget(null); }}
      title="Revoke this invitation?" description={`The link sent to ${revokeTarget?.email ?? 'this address'} will stop working.`}
      confirmLabel="Revoke invitation" destructive pending={busy} error={dialogError} onConfirm={() => void confirmRevoke()} />

    <Dialog open={activateTarget !== null} onOpenChange={(next) => { if (!next && !busy) setActivateTarget(null); }}>
      <DialogContent onCloseAutoFocus={(event) => {
        const opener = activateOpener.current;
        if (opener?.isConnected) { event.preventDefault(); opener.focus(); }
      }}>
        <DialogTitle>Authorize administrator activation</DialogTitle>
        <DialogDescription asChild>
          <div className={styles.form}>
            <p className={styles.panelHint}>Send a secure, one-time activation link to this administrator. They must verify their identity, create a new password and set up two-step verification before accessing the Admin Console.</p>
            {dialogError && <Alert variant="error">{dialogError}</Alert>}
            <dl className={styles.cellText}>
              <div><dt>Administrator</dt><dd><strong>{`${activateTarget?.firstName ?? ''} ${activateTarget?.lastName ?? ''}`.trim() || activateTarget?.email}</strong></dd></div>
              <div><dt>Email</dt><dd>{activateTarget?.email}</dd></div>
              <div><dt>Two-step verification</dt><dd>Not set up</dd></div>
              <div><dt>Link expires</dt><dd>30 minutes after it is sent</dd></div>
            </dl>
            <Alert variant="warning">Activation grants privileged administrative access once two-step verification is set up. Only continue if you have confirmed this person controls this email address.</Alert>
            <div className={styles.formActions}>
              <Button type="button" variant="outline" onClick={() => setActivateTarget(null)} disabled={busy}>Cancel</Button>
              <Button type="button" onClick={() => void confirmActivation()} isLoading={busy}>Send activation link</Button>
            </div>
          </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>

    <ConfirmDialog open={revokeActivationTarget !== null} onOpenChange={(next) => { if (!next && !busy) setRevokeActivationTarget(null); }}
      title="Revoke this activation?" description={`The activation link sent to ${revokeActivationTarget?.email ?? 'this administrator'} will stop working.`}
      confirmLabel="Revoke activation" destructive pending={busy} error={dialogError} onConfirm={() => void confirmRevokeActivation()} />

    <Dialog open={inviteOpen} onOpenChange={(next) => { if (!busy) setInviteOpen(next); }}>
      <DialogContent>
        <DialogTitle>Invite an administrator</DialogTitle>
        <DialogDescription asChild>
          <form className={styles.form} onSubmit={submitInvite} noValidate>
            <p className={styles.panelHint}>They receive a one-time link to create their account and set up two-step verification.</p>
            {dialogError && <Alert variant="error">{dialogError}</Alert>}
            <Input id="invite-admin-email" name="email" label="Email address" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
              error={inviteFieldError} autoComplete="off" fullWidth disabled={busy} />
            <label className={secStyles.checkRow}>
              <Checkbox checked={inviteManage} onCheckedChange={(value) => setInviteManage(value === true)} disabled={busy} aria-describedby="invite-manage-help" />
              <span>Allow them to manage administrators</span>
            </label>
            <p id="invite-manage-help" className={styles.panelHint}>Only grant this to people who should invite and change other administrators.</p>
            <div className={styles.formActions}>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" isLoading={busy}>Send invitation</Button>
            </div>
          </form>
        </DialogDescription>
      </DialogContent>
    </Dialog>

    {stepUpDialog}
  </div>;
}
