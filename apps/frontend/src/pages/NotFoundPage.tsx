import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import styles from './NotFoundPage.module.scss';

export function NotFoundPage() {
  return (
    <main className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>404</h1>
        <h2 className={styles.subtitle}>Page Not Found</h2>
        <p className={styles.description}>
          The page you are looking for doesn't exist or has been moved.
        </p>
        <Link to="/" className={styles.homeLink}>
          <Home className={styles.homeIcon} aria-hidden="true" />
          Back to Home
        </Link>
      </div>
    </main>
  );
}
