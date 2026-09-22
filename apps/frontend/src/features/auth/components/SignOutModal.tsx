import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { useAuth } from '../context/AuthContext';
import styles from './SignOutModal.module.scss';
import { ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

interface SignOutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SignOutModal({ open, onOpenChange }: SignOutModalProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignOut = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      await logout();
      onOpenChange(false);
      navigate('/');
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred during sign out.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!isLoading) onOpenChange(val); }}>
      <DialogContent 
        className={styles.modalContent} 
        overlayClassName={styles.overlay}
        hideCloseButton
        onInteractOutside={(e) => {
          if (isLoading) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isLoading) e.preventDefault();
        }}
      >
        <div className={styles.header}>
          <DialogTitle className={styles.title}>Sign Out</DialogTitle>
          <DialogDescription className={styles.description}>Are you sure you want to sign out?</DialogDescription>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div className={styles.actions}>
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)} 
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleSignOut} 
            disabled={isLoading} 
            isLoading={isLoading}
          >
            {isLoading ? 'Signing out...' : 'Sign Out'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
