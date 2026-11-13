import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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

type RevealPhase = 'static' | 'pending' | 'visible' | 'settled';

/**
 * IntersectionObserver only reports a change of intersection. A restored scroll position (back/forward, reload) can jump a pending
 * section from below the viewport to above it without ever intersecting, so no callback fires and it would stay hidden. One shared,
 * passive, frame-throttled scroll listener (alive only while some section is pending) settles those sections.
 */
const awaiting = new Map<Element, () => void>();
let scrollFrame = 0;
const sweepPassed = () => {
  scrollFrame = 0;
  awaiting.forEach((settle, node) => { if (node.getBoundingClientRect().bottom <= 0) settle(); });
  if (awaiting.size === 0) window.removeEventListener('scroll', onAwaitingScroll);
};
function onAwaitingScroll() { if (!scrollFrame) scrollFrame = window.requestAnimationFrame(sweepPassed); }
function awaitPassed(node: Element, settle: () => void) {
  if (awaiting.size === 0) window.addEventListener('scroll', onAwaitingScroll, { passive: true });
  awaiting.set(node, settle);
  return () => {
    awaiting.delete(node);
    if (awaiting.size === 0) { window.removeEventListener('scroll', onAwaitingScroll); window.cancelAnimationFrame(scrollFrame); scrollFrame = 0; }
  };
}

/**
 * Reveal once, then stay put. A section that enters the viewport animates a single time and is never hidden or replayed again,
 * whichever direction the page is scrolled. Sections already above the viewport when observed (reload, back/forward scroll
 * restoration, an anchor jump) are settled without animation so scrolling up never plays or hides them.
 * Content stays in the DOM and fully visible when IntersectionObserver is missing or the visitor prefers reduced motion.
 */
export function SectionReveal({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<RevealPhase>('static');

  // Layout effect: the starting phase is decided before the first paint. Before Task 06.2 every section painted visible, was then
  // hidden (`pending`, opacity 0) and only reappeared when the IntersectionObserver callback ran, so on a reload or a slow device the
  // content already on screen flashed or stayed blank until that callback. A section already in the viewport now starts its
  // entrance immediately (CSS animation, no observer needed); one above it is settled; only sections below the fold wait.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof window.IntersectionObserver !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const rect = node.getBoundingClientRect();
    const measured = rect.width > 0 || rect.height > 0;
    if (measured && rect.bottom > 0 && rect.top < window.innerHeight) { setPhase('visible'); return; }
    if (measured && rect.bottom <= 0) { setPhase('settled'); return; }

    setPhase('pending');
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      // Only a still-pending section may change: once revealed or settled it is final.
      if (entry.isIntersecting) {
        setPhase(current => current === 'pending' ? 'visible' : current);
        observer.disconnect();
        awaiting.delete(entry.target);
      } else if (entry.boundingClientRect && entry.boundingClientRect.bottom <= 0) {
        // Already scrolled past: show it in its final state, no animation.
        setPhase(current => current === 'pending' ? 'settled' : current);
        observer.disconnect();
        awaiting.delete(entry.target);
      }
    }, { threshold: 0 });

    observer.observe(node);
    const release = awaitPassed(node, () => { setPhase(current => current === 'pending' ? 'settled' : current); observer.disconnect(); release(); });
    return () => { observer.disconnect(); release(); };
  }, []);

  return <div ref={ref} style={style} className={`${className} ${styles.reveal} ${phase === 'pending' ? styles.pending : ''} ${phase === 'visible' ? styles.visible : ''}`}>{children}</div>;
}

export function StaggerContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <SectionReveal className={`${className} ${styles.stagger}`}>{children}</SectionReveal>;
}

/** Cards in a grid reveal once, a controlled stagger after the grid enters; the parent owns the observer. */
export function BenefitsReveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'static' | 'pending' | 'visible'>('static');

  useEffect(() => {
    const node = ref.current;
    if (!node || !window.matchMedia) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let hasScrolled = false;
    let frame = 0;
    let done = false;

    const stop = () => {
      done = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
    };
    function measure() {
      frame = 0;
      if (done || preference.matches || !hasScrolled) return;
      const bounds = node!.getBoundingClientRect();
      if (bounds.height <= 0) return;
      const visibleHeight = Math.max(0, Math.min(bounds.bottom, window.innerHeight) - Math.max(bounds.top, 0));
      const reached = visibleHeight >= Math.min(bounds.height * 0.45, window.innerHeight * 0.3);
      if (reached) { setPhase('visible'); stop(); }
      // Scrolled up past it before it ever animated (e.g. restored scroll position): never hide or replay it.
      else if (bounds.bottom < 0) { setPhase('static'); stop(); }
    }
    function onScroll() {
      hasScrolled = true;
      if (!frame) frame = window.requestAnimationFrame(measure);
    }
    if (preference.matches) { setPhase('static'); return; }
    setPhase('pending');
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    return stop;
  }, []);

  return <div ref={ref} className={`${className} ${phase === 'pending' ? styles.benefitsPending : ''} ${phase === 'visible' ? styles.benefitsVisible : ''}`}>{children}</div>;
}

export function StaggerItem({ children, index = 0, className = '' }: { children: ReactNode; index?: number; className?: string }) {
  const style = { '--motion-delay': `${Math.min(index, 8) * 70}ms` } as CSSProperties;
  return <div className={`${styles.item} ${className}`} style={style}>{children}</div>;
}
