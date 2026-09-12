import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/Dialog';
import styles from './HomePage.module.scss';

/**
 * Home Page — Foundation placeholder.
 * Will be replaced with the actual home page implementation.
 */
export function HomePage() {
  return (
    <main className={styles.container}>
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
