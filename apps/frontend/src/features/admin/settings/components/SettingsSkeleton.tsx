import { Skeleton } from '@/components/ui/Skeleton';
import styles from '@/features/admin/shared/AdminPages.module.scss';
import local from './SettingsSkeleton.module.scss';

type Section = 'store' | 'shipping' | 'notifications';

/** Mirrors the fields of each settings form while keeping one accessible loading announcement. */
export function SettingsSkeleton({ section }: { section: Section }) {
  const label = section === 'store' ? 'store settings' : section === 'shipping' ? 'shipping settings' : 'notification preferences';
  const fieldCount = section === 'store' ? 10 : 4;
  return <div className={local.stack} aria-busy="true" role="status" aria-label={`Loading ${label}`}>
    <section className={styles.panel} aria-hidden="true">
      <Skeleton width="13rem" height="1.4rem" />
      <Skeleton width="min(25rem, 90%)" height="0.875rem" />
      {section === 'notifications' ? <div className={local.options}>
        <Skeleton width="10rem" height="1rem" />
        {[0, 1].map(item => <div className={local.option} key={item}>
          <Skeleton width="1.25rem" height="1.25rem" />
          <div className={local.field}><Skeleton width="11rem" height="1rem" /><Skeleton width="min(18rem, 100%)" height="0.75rem" /></div>
        </div>)}
      </div> : <div className={section === 'store' ? local.fieldGrid : local.fields}>
        {Array.from({ length: fieldCount }, (_, index) => <div className={local.field} key={index}>
          <Skeleton width="7rem" height="0.875rem" /><Skeleton height="2.5rem" />
        </div>)}
        {section === 'shipping' && <div className={local.options}>
          {[0, 1, 2, 3].map(item => <div className={local.option} key={item}><Skeleton width="1.25rem" height="1.25rem" /><Skeleton width="15rem" height="1rem" /></div>)}
        </div>}
      </div>}
      <div className={local.action}><Skeleton width="9rem" height="2.5rem" /></div>
    </section>
    {section === 'shipping' && <section className={styles.panel} aria-hidden="true">
      <Skeleton width="9rem" height="1.4rem" /><Skeleton width="min(27rem, 90%)" height="0.875rem" />
      <div className={local.quote}><div className={local.field}><Skeleton width="8rem" height="0.875rem" /><Skeleton height="2.5rem" /></div><Skeleton width="9rem" height="2.5rem" /></div>
    </section>}
  </div>;
}
