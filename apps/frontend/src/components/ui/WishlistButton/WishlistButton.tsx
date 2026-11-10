import { Heart } from 'lucide-react';
import styles from './WishlistButton.module.scss';

export interface WishlistButtonProps {
  title: string;
  saved: boolean;
  pending?: boolean;
  /** The toggle cannot be accepted yet (for example while the stored session is re-verified), so a click would be dropped. */
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
}
export function WishlistButton({ title, saved, pending = false, disabled = false, onToggle, className = '' }: WishlistButtonProps) {
  return <button type="button" className={`${styles.button} ${className}`} aria-pressed={saved} aria-busy={pending} disabled={disabled}
    aria-label={`${saved ? 'Remove' : 'Add'} ${title} ${saved ? 'from' : 'to'} wishlist`}
    data-wishlist-heart data-pending={pending} onClick={event => { event.preventDefault(); event.stopPropagation(); onToggle(); }}>
    <Heart size={20} aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
  </button>;
}
