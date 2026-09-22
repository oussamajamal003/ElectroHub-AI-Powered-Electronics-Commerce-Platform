import { EmptyState } from '@/components/ui/EmptyState';
import { Package, Heart, ShoppingBag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

interface PlaceholderPageProps {
  title: string;
  description?: string;
  type?: 'cart' | 'wishlist' | 'orders';
}

export function PlaceholderPage({ title, description, type }: PlaceholderPageProps) {
  const navigate = useNavigate();
  
  let icon = <Package size={48} />;
  if (type === 'wishlist') icon = <Heart size={48} />;
  if (type === 'cart') icon = <ShoppingBag size={48} />;

  return (
    <div style={{ minHeight: 'calc(100vh - 80px)', padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <h1 style={{ fontFamily: 'var(--font-family-heading)', fontSize: '32px', marginBottom: '24px' }}>{title}</h1>
      <EmptyState
        icon={icon}
        title={title}
        description={description || `${title} functionality is coming soon.`}
        action={
          <Button variant="primary" onClick={() => navigate('/products')}>
            Continue Shopping
          </Button>
        }
      />
    </div>
  );
}
