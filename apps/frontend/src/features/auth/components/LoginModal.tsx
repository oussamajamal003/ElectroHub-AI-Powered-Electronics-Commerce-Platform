import { AuthModal } from './AuthModal';

export interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToRegister?: () => void;
}

export function LoginModal({ open, onOpenChange, onSwitchToRegister }: LoginModalProps) {
  return (
    <AuthModal
      open={open}
      onOpenChange={onOpenChange}
      initialMode="login"
      onSwitchToRegister={onSwitchToRegister}
    />
  );
}
