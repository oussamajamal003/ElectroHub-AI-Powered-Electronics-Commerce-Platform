import { Heart } from 'lucide-react';
import styles from './WishlistButton.module.scss';

export interface WishlistButtonProps {
  title: string;
  saved: boolean;
  pending?: boolean;
  onToggle: () => void;
  className?: string;
}
export function WishlistButton({ title, saved, pending = false, onToggle, className = '' }: WishlistButtonProps) {
  return <button type="button" className={`${styles.button} ${className}`} aria-pressed={saved} aria-busy={pending}
    aria-label={`${saved ? 'Remove' : 'Add'} ${title} ${saved ? 'from' : 'to'} wishlist`}
    data-wishlist-heart data-pending={pending} onClick={event => { event.preventDefault(); event.stopPropagation(); onToggle(); }}>
    <Heart size={20} aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
  </button>;
}
