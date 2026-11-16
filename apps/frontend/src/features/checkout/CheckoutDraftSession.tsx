import { useEffect, useRef } from 'react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { clearDraft, detachDraft, draftWasSubmitted, forgetSubmittedPurchase, readDraft } from './state';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query';
import { clearBuyNow } from './buyNow';
import { useLocation, useNavigate } from 'react-router-dom';

export function CheckoutDraftSession() {
  const { user, isSessionVerified } = useAuth(); const previous = useRef<string | null>(user?.id ?? null);
  const location = useLocation(); const navigate = useNavigate();
  const client = useQueryClient();
  const previousPath = useRef(location.pathname);
  useEffect(() => {
    const path = previousPath.current;
    previousPath.current = location.pathname;
    if (!isSessionVerified || !user?.id || path === location.pathname || !['/checkout', '/checkout/buy-now'].includes(path)) return;
    // A submitted Buy Now belongs to its saved purchase: its selection must not reopen a blank, payable Buy Now form.
    if (path === '/checkout/buy-now' && draftWasSubmitted(readDraft(user.id, 'BUY_NOW'))) clearBuyNow();
    detachDraft(user.id, path === '/checkout/buy-now' ? 'BUY_NOW' : 'CART_CHECKOUT');
    if (location.pathname === '/cart') void client.invalidateQueries(
      { queryKey: queryKeys.cart.current(user.id), exact: true }, { cancelRefetch: false });
  }, [location.pathname, isSessionVerified, user?.id, client]);
  useEffect(() => {
    if (location.pathname !== '/checkout' && location.pathname !== '/checkout/buy-now') return;
    const query = new URLSearchParams(location.search);
    if (query.has('payment_intent_client_secret') || query.has('payment_intent') || query.has('redirect_status')) {
      // Scrub provider return parameters even while the protected route is restoring auth.
      // The saved owned attempt, never redirect claims, determines the outcome.
      navigate(`${location.pathname}?step=review`, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);
  useEffect(() => {
    if (!isSessionVerified) return;
    const id = user?.id ?? null;
    if (previous.current && previous.current !== id) { clearDraft(previous.current); clearDraft(previous.current, 'BUY_NOW'); clearBuyNow(); forgetSubmittedPurchase(previous.current, 'CART_CHECKOUT'); forgetSubmittedPurchase(previous.current, 'BUY_NOW'); }
    previous.current = id;
  }, [user?.id, isSessionVerified]);
  return null;
}
