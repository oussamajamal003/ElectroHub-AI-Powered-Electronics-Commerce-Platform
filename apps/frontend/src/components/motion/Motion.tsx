import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import styles from './Motion.module.scss';

let homeEntrancePlayed = false;

export function HeroEntrance({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [play] = useState(() => {
    if (homeEntrancePlayed) return false;
    homeEntrancePlayed = true;
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.type === 'back_forward') return false;
    return true;
  });
  return <section className={`${className} ${play ? styles.heroEntrance : ''}`} aria-labelledby="home-title">{children}</section>;
}

export function SectionReveal({ children, className = '', replay = false, style }: { children: ReactNode; className?: string; replay?: boolean; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [hasRevealed, setHasRevealed] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof window.IntersectionObserver !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    setArmed(true);

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        setHasRevealed(true);
        if (!replay) {
          // One-shot: disconnect once revealed
          observer.disconnect();
        }
      } else if (replay) {
        // Reset visibility when element is truly out of view so re-entry animates.
        // Crucially, hasRevealed remains TRUE, preventing .pending (opacity: 0) from hiding cards!
        setVisible(false);
      }
    }, { threshold: 0, rootMargin: replay ? '50px 0px 50px 0px' : '0px 0px 0px 0px' });

    observer.observe(node);

    return () => observer.disconnect();
  }, [replay]);

  const isPending = armed && !hasRevealed && !visible;

  return <div ref={ref} style={style} className={`${className} ${styles.reveal} ${isPending ? styles.pending : ''} ${visible ? styles.visible : ''}`}>{children}</div>;
}

export function StaggerContainer({ children, className = '', replay = false }: { children: ReactNode; className?: string; replay?: boolean }) {
  return <SectionReveal className={`${className} ${styles.stagger}`} replay={replay}>{children}</SectionReveal>;
}

export function BenefitsReveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'static' | 'pending' | 'visible'>('static');

  useEffect(() => {
    const node = ref.current;
    if (!node || !window.matchMedia) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let hasScrolled = false;
    let revealed = false;
    let frame = 0;

    const measure = () => {
      frame = 0;
      if (preference.matches || !hasScrolled) return;
      const bounds = node.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(bounds.bottom, window.innerHeight) - Math.max(bounds.top, 0));
      const reached = visibleHeight >= Math.min(bounds.height * 0.45, window.innerHeight * 0.3);
      if (!revealed && reached && bounds.height > 0) {
        revealed = true;
        setPhase('visible');
      } else if (revealed && (bounds.bottom < -64 || bounds.top > window.innerHeight + 64)) {
        revealed = false;
        setPhase('pending');
      }
    };
    const onScroll = () => {
      hasScrolled = true;
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const onPreference = () => {
      revealed = false;
      setPhase(preference.matches ? 'static' : 'pending');
    };
    onPreference();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    preference.addEventListener?.('change', onPreference);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      preference.removeEventListener?.('change', onPreference);
    };
  }, []);

  return <div ref={ref} className={`${className} ${phase === 'pending' ? styles.benefitsPending : ''} ${phase === 'visible' ? styles.benefitsVisible : ''}`}>{children}</div>;
}

export function StaggerItem({ children, index = 0, replay = false, className = '' }: { children: ReactNode; index?: number; replay?: boolean; className?: string }) {
  const style = { '--motion-delay': `${Math.min(index, 8) * 70}ms` } as CSSProperties;
  if (replay) return <SectionReveal className={`${styles.item} ${className}`} replay style={style}>{children}</SectionReveal>;
  return <div className={`${styles.item} ${className}`} style={style}>{children}</div>;
}
