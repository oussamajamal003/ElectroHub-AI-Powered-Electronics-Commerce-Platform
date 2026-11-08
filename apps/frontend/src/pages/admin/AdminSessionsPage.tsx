import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import {
  useAdminLoginHistory, useAdminSessions, useRevokeOtherSessions, useRevokeSession,
  type AdminSessionSummary, type LoginHistoryEvent,
} from '@/features/admin/security/api';
import { describeAdminAuthError } from '@/features/admin/security/errors';
import { isStepUpCancelled, useStepUp } from '@/features/admin/security/useStepUp';
import {
  ConfirmDialog, EmptyRows, ListEmpty, PageHeader, Pager, QueryProblem, StatusPill, TableCard, useAdminToast,
} from '@/features/admin/shared/AdminUi';
import { formatDateTime } from '@/features/admin/shared/format';
import styles from '@/features/admin/shared/AdminPages.module.scss';

const METHOD_LABELS: Record<string, string> = {
  TOTP: 'Authenticator app',
  PASSKEY: 'Passkey',
  WEBAUTHN: 'Passkey',
  RECOVERY_CODE: 'Recovery code',
};

const EVENT_LABELS: Record<string, string> = {
  LOGIN: 'Signed in',
  MFA_FAILED: 'Verification failed',
  STEP_UP: 'Identity confirmed',
  LOGOUT: 'Signed out',
  SESSION_REVOKED: 'Session signed out',
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_RESET: 'Password reset',
  FACTOR_ADDED: 'Authenticator added',
  FACTOR_REMOVED: 'Authenticator removed',
  RECOVERY_CODES_REGENERATED: 'Recovery codes regenerated',
  RECOVERY_CODE_USED: 'Recovery code used',
  PASSKEY_ADDED: 'Passkey added',
  PASSKEY_REMOVED: 'Passkey removed',
};

type PendingRevoke = AdminSessionSummary | 'others' | null;

/** Lists the administrator's own sessions and login history. Revoking sessions is a sensitive action, so it always goes through step-up. */
export function AdminSessionsPage() {
  const navigate = useNavigate();
  const { clearSession } = useAdminAuth();
  const toast = useAdminToast();
  const { runWithStepUp, dialog: stepUpDialog } = useStepUp();
  const [sessionPage, setSessionPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const sessions = useAdminSessions(sessionPage);
  const history = useAdminLoginHistory(historyPage);
  const revokeOne = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [pending, setPending] = useState<PendingRevoke>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const closeDialog = () => {
    if (busy) return;
    setPending(null);
    setDialogError(null);
  };

  const confirmRevoke = async () => {
    if (!pending) return;
    setBusy(true);
    setDialogError(null);
    try {
      if (pending === 'others') {
        await runWithStepUp(() => revokeOthers.mutateAsync(undefined));
        setPending(null);
        toast('Other sessions signed out.');
      } else if (pending.current) {
        // Signing out the session this page runs in: drop local auth state and return to sign-in.
        await runWithStepUp(() => revokeOne.mutateAsync(pending.id));
        clearSession();
        navigate('/admin/login', { replace: true });
      } else {
        await runWithStepUp(() => revokeOne.mutateAsync(pending.id));
        setPending(null);
        toast('Session signed out.');
      }
    } catch (error) {
      if (!isStepUpCancelled(error)) setDialogError(describeAdminAuthError(error, 'session').message);
    } finally {
      setBusy(false);
    }
  };

  const sessionColumns: Column<AdminSessionSummary>[] = [
    { key: 'device', title: 'Device', render: row => <span className={styles.cellText}>
      <strong>{row.device || 'Unknown device'}</strong>
      {row.current && <StatusPill tone="success">This session</StatusPill>}
    </span> },
    { key: 'method', title: 'Verified with', render: row => METHOD_LABELS[row.mfaMethod] ?? 'Verification' },
    { key: 'ip', title: 'Network', render: row => <span className={styles.mono}>{row.ipMasked ?? 'Hidden'}</span> },
    { key: 'signedIn', title: 'Signed in', render: row => formatDateTime(row.createdAt) },
    { key: 'lastActive', title: 'Last active', render: row => formatDateTime(row.lastActiveAt) },
    { key: 'actions', title: '', align: 'right', render: row => <Button type="button" variant="outline" size="small"
      onClick={() => setPending(row)} aria-label={row.current ? 'Sign out this session' : `Sign out session on ${row.device || 'unknown device'}`}>
      {row.current ? 'Sign out here' : 'Sign out'}</Button> },
  ];

  const historyColumns: Column<LoginHistoryEvent>[] = [
    { key: 'event', title: 'Event', render: row => EVENT_LABELS[row.event] ?? 'Account activity' },
    { key: 'outcome', title: 'Outcome', render: row => row.outcome === 'SUCCESS'
      ? <StatusPill tone="success">Success</StatusPill>
      : <StatusPill tone="error">Failed</StatusPill> },
    { key: 'device', title: 'Device', render: row => row.device ?? 'Unknown device' },
    { key: 'ip', title: 'Network', render: row => <span className={styles.mono}>{row.ipMasked ?? 'Hidden'}</span> },
    { key: 'when', title: 'When', render: row => formatDateTime(row.occurredAt) },
  ];

  const sessionRows = sessions.data?.data ?? [];
  const otherCount = sessionRows.filter(row => !row.current).length;

  return <div className={styles.page}>
    <PageHeader title="Sessions and login history" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'My Profile', to: '/admin/profile' }, { label: 'Sessions' }]}
      description="Where your administrator account is signed in, and recent sign-in activity." />

    {sessions.isError && !sessions.data && <QueryProblem error={sessions.error} hasData={false} onRetry={() => void sessions.refetch()} retrying={sessions.isFetching} what="Your sessions" />}
    <section className={styles.panelFlush} aria-labelledby="sessions-active-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="sessions-active-title" className={styles.panelTitle}>Active sessions</h2>
          <p className={styles.panelHint}>Sign out any session you do not recognise. Signing out other sessions keeps this one open.</p>
        </div>
        <Button type="button" variant="outline" size="small" disabled={otherCount === 0 || sessions.isPending} onClick={() => setPending('others')}>
          Sign out other sessions
        </Button>
      </div>
      <TableCard busy={sessions.isPlaceholderData} label="Active sessions">
        <DataTable caption="Active sessions" data={sessionRows} columns={sessionColumns} keyExtractor={row => row.id}
          loadingRows={sessions.isPending ? 3 : undefined}
          emptyMessage={<ListEmpty failed={sessions.isError && !sessions.data}>
            <EmptyRows title="No active sessions" hint="Sessions appear here after you sign in." />
          </ListEmpty>} />
      </TableCard>
      <Pager meta={sessions.data?.meta} onPage={setSessionPage} disabled={sessions.isPlaceholderData} label="Session pages" />
    </section>

    {history.isError && !history.data && <QueryProblem error={history.error} hasData={false} onRetry={() => void history.refetch()} retrying={history.isFetching} what="Your login history" />}
    <section className={styles.panelFlush} aria-labelledby="sessions-history-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="sessions-history-title" className={styles.panelTitle}>Login history</h2>
          <p className={styles.panelHint}>Recent sign-in and verification events for your account.</p>
        </div>
      </div>
      <TableCard busy={history.isPlaceholderData} label="Login history">
        <DataTable caption="Login history" data={history.data?.data ?? []} columns={historyColumns} keyExtractor={row => row.id}
          loadingRows={history.isPending ? 5 : undefined}
          emptyMessage={<ListEmpty failed={history.isError && !history.data}>
            <EmptyRows title="No sign-in activity yet" />
          </ListEmpty>} />
      </TableCard>
      <Pager meta={history.data?.meta} onPage={setHistoryPage} disabled={history.isPlaceholderData} label="Login history pages" />
    </section>

    <ConfirmDialog open={pending !== null} onOpenChange={(next) => { if (!next) closeDialog(); }}
      title={pending === 'others' ? 'Sign out all other sessions?' : pending?.current ? 'Sign out of this session?' : 'Sign out this session?'}
      description={pending === 'others'
        ? 'Every other place where your administrator account is signed in will be signed out. This session stays open.'
        : pending?.current
          ? 'You will be returned to the sign-in page on this device.'
          : 'That device will be signed out and must sign in again.'}
      confirmLabel={pending === 'others' ? 'Sign out others' : 'Sign out'} destructive pending={busy} error={dialogError}
      onConfirm={() => void confirmRevoke()} />

    {stepUpDialog}
  </div>;
}
