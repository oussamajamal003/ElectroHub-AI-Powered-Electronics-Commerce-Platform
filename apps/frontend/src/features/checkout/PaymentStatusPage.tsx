import { Navigate, useParams } from 'react-router-dom';
/** Legacy bookmarks retain their purchase identity; Cart observes server outcomes. */
export function PaymentStatusPage() {
  const { attemptId = '' } = useParams();
  return <Navigate replace to={`/cart?purchase=${encodeURIComponent(attemptId)}`} />;
}
