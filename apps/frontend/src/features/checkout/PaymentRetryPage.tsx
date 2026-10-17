import { Navigate, useParams } from 'react-router-dom';

/**
 * Legacy deep link (bookmarks, old notifications). A failed purchase is paid again only from
 * Checkout's Payment Failed screen, which resumes the same attempt in the Payment step. This
 * route never contacts the payment service, so opening it cannot start or extend an attempt.
 */
export function PaymentRetryPage() {
  const { attemptId = '' } = useParams();
  return <Navigate to={attemptId ? `/cart?purchase=${encodeURIComponent(attemptId)}` : '/cart'} replace />;
}
