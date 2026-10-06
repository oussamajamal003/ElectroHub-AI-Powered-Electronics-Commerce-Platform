import { useEffect, useRef } from 'react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { clearDraft } from './state';

export function CheckoutDraftSession() {
  const { user, isSessionVerified } = useAuth(); const previous = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    if (!isSessionVerified) return;
    const id = user?.id ?? null;
    if (previous.current && previous.current !== id) clearDraft(previous.current);
    previous.current = id;
  }, [user?.id, isSessionVerified]);
  return null;
}
