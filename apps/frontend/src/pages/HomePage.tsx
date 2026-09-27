import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/Dialog';
import styles from './HomePage.module.scss';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';

/**
 * Home Page — Foundation placeholder.
 * Will be replaced with the actual home page implementation.
 */
export function HomePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [accountDeleted, setAccountDeleted] = useState(false);

  useEffect(() => {
    if (location.state?.accountDeleted) {
      setAccountDeleted(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  return (
    <main className={styles.container}>
      {accountDeleted && <Alert variant="success">Your account has been deleted.</Alert>}
      <h1 className={styles.title}>ElectroHub</h1>
      <p className={styles.subtitle}>AI-Powered Electronics Commerce Platform</p>
      
      <div className={styles.content}>
        <Dialog>
          <DialogTrigger asChild>
            <button className={styles.triggerButton}>
              Open Foundation Dialog
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Frontend Foundation</DialogTitle>
            <DialogDescription>
              This dialog demonstrates the integration of Radix UI primitives,
              Framer Motion animations, Lucide icons, and SCSS modules following 
              the ElectroHub styling standards.
            </DialogDescription>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
