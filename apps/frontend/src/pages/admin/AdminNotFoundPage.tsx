import { ButtonLink, PageHeader } from '@/features/admin/shared/AdminUi';
import styles from '@/features/admin/shared/AdminPages.module.scss';

/** Unknown /admin/* paths stay inside the console shell instead of falling through to the storefront 404. */
export function AdminNotFoundPage() {
  return <div className={styles.page}>
    <PageHeader title="Page not found" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Not found' }]} />
    <div className={styles.notFound}>
      <p>This admin page does not exist. It may have moved, or the link is incomplete.</p>
      <ButtonLink to="/admin" variant="outline">Back to dashboard</ButtonLink>
    </div>
  </div>;
}
