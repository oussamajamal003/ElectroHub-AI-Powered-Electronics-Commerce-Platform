import { AuthModal } from './AuthModal';

export interface RegisterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToLogin?: () => void;
}

export function RegisterModal({ open, onOpenChange, onSwitchToLogin }: RegisterModalProps) {
  return (
    <AuthModal
      open={open}
      onOpenChange={onOpenChange}
      initialMode="register"
      onSwitchToLogin={onSwitchToLogin}
    />
  );
}
