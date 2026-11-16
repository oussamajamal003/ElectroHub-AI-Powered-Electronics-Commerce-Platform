import { Skeleton } from '@/components/ui/Skeleton';
import account from '@/pages/customer/AccountPage.module.scss';
import profile from '@/pages/customer/ProfilePage.module.scss';
import admin from '@/features/admin/shared/AdminPages.module.scss';
import styles from './AccountSkeleton.module.scss';

function Lines({ fields = false }: { fields?: boolean }) {
  return <div className={styles.stack}>{[0, 1, 2].map(index => <div className={styles.stack} key={index}>
    <Skeleton width={`${40 + index * 10}%`} height={16} />
    {fields && <Skeleton width="100%" height={44} />}
  </div>)}</div>;
}
function Identity() {
  return <div className={styles.identity}><Skeleton variant="circular" width={72} height={72} /><div className={styles.grow}><Lines /></div></div>;
}
function Heading() { return <div className={styles.stack}><Skeleton width="9rem" height={16} /><Skeleton width="min(20rem, 80%)" height={36} /><Skeleton width="min(32rem, 90%)" height={20} /></div>; }

/** Public placeholders only: no cached identity is rendered while the session is being restored. */
export function CustomerAccountSkeleton({ variant = 'account' }: { variant?: 'account' | 'profile' }) {
  const isProfile = variant === 'profile';
  const layout = isProfile ? profile : account;
  const label = isProfile ? 'Loading your profile' : 'Loading your account';
  return <div className={layout.page} role="status" aria-label={label} aria-busy="true" data-account-skeleton={variant}>
    <span className={styles.srOnly}>{label}…</span>
    <div className={layout.container} aria-hidden="true">
      <Heading />
      {isProfile ? <div className={profile.sections}>
        <div className={profile.card}><Identity /><Lines fields /><Skeleton width="100%" height={44} /></div>
        <div className={profile.card}><Skeleton width="65%" height={24} /><Lines fields /><Skeleton width="60%" height={44} /></div>
        <div className={`${profile.card} ${profile.dangerZone}`}><Lines /><Skeleton width="50%" height={44} /></div>
      </div> : <>
        <div className={account.profileCard}><Identity /><Skeleton width="8rem" height={44} /></div>
        <div className={account.grid}>{[0, 1, 2, 3].map(index => <div className={account.gridItem} key={index}><Skeleton width={44} height={44} /><div className={styles.grow}><Lines /></div></div>)}</div>
        <div className={styles.panel}><Skeleton width="14rem" height={24} /><Lines /><Skeleton width="14rem" height={44} /></div>
        <div className={styles.panel}><Skeleton width="14rem" height={24} /><Lines /></div>
        <div className={styles.reviewGrid}>{[0, 1, 2].map(index => <div className={styles.panel} key={index}><Skeleton width="100%" height={140} /><Lines /></div>)}</div>
      </>}
    </div>
  </div>;
}

export type AdminAccountVariant = 'profile' | 'security' | 'sessions';
export function AdminAccountSkeleton({ variant = 'profile', heading = true }: { variant?: AdminAccountVariant; heading?: boolean }) {
  const label = variant === 'profile' ? 'Loading administrator profile' : variant === 'security' ? 'Loading security settings' : 'Loading sessions and login history';
  return <div className={admin.page} role="status" aria-label={label} aria-busy="true" data-account-skeleton={`admin-${variant}`}>
    <span className={styles.srOnly}>{label}…</span>
    {heading && <div aria-hidden="true"><Heading /></div>}
    <div aria-hidden="true" className={admin.stack}>
      {variant === 'profile' ? <>
        <div className={admin.split}><div className={admin.panel}><Skeleton width="50%" height={24} /><Identity /><Lines fields /><Skeleton width="60%" height={44} /></div><div className={admin.panel}><Skeleton width="70%" height={24} /><Lines /></div></div>
        <div className={admin.split}><div className={admin.panel}><Lines fields /></div><div className={admin.panel}><Lines /><Skeleton width="80%" height={44} /></div></div>
      </> : variant === 'security' ? <>
        <Skeleton width="100%" height={48} />
        {[0, 1, 2].map(index => <div className={admin.panel} key={index}><Skeleton width="min(16rem, 70%)" height={24} /><Lines /><Skeleton width="min(12rem, 60%)" height={40} /></div>)}
      </> : [3, 5].map((rows, index) => <div className={admin.panel} key={index}><Skeleton width="min(20rem, 70%)" height={24} />{Array.from({ length: rows }, (_, row) => <div className={styles.tableRow} key={row}><Skeleton width="100%" height={20} /><Skeleton width="100%" height={20} /><Skeleton width="100%" height={20} /></div>)}</div>)}
    </div>
  </div>;
}
