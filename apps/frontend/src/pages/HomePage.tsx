import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, RotateCcw, ShieldCheck, Truck, Zap } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CategoryCard } from '@/components/ui/CategoryCard';
import { ProductCard } from '@/components/ui/ProductCard';
import { ProductCardSkeleton } from '@/components/ui/ProductCard/ProductCardSkeleton';
import { productCardProps } from '@/features/search/api';
import { useCategories } from '@/features/search/queries';
import { useDeals, useProducts } from '@/features/products/queries';
import { BenefitsReveal, HeroEntrance, SectionReveal, StaggerContainer, StaggerItem } from '@/components/motion/Motion';
import styles from './HomePage.module.scss';

const HERO_IMAGES = [
  // Laptops
  '/images/catalog/laptops.jpg',
  '/images/catalog/variety/macbook13-01.jpg',
  '/images/catalog/variety/thinkpad-01.jpg',
  // Smartphones
  '/images/catalog/smartphones.jpg',
  '/images/catalog/variety/iphone15-01.jpg',
  '/images/catalog/variety/samsung-phone-04.jpg',
  // Tablets
  '/images/catalog/tablets.jpg',
  '/images/catalog/variety/ipadair-01.jpg',
  '/images/catalog/variety/galaxytab-graphite-1.jpg',
  // Audio
  '/images/catalog/headphones.jpg',
  '/images/catalog/variety/sonyheadphones-01.jpg',
  '/images/catalog/variety/galaxybuds-01.jpg',
  // Watches
  '/images/catalog/smartwatches.jpg',
  '/images/catalog/variety/applewatch-01.jpg',
  // Monitors
  '/images/catalog/monitors.jpg',
  '/images/catalog/variety/monitor-asus-01.jpg',
  // Accessories
  '/images/catalog/accessories.jpg',
  '/images/catalog/variety/accessory-hp-keyboard-01.jpg',
];

const HERO_INTERVAL_MS = 2000;

function useHeroRotation(images: readonly string[]) {
  const [index, setIndex] = useState(0);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const fallback = images[0] ?? '/images/catalog/laptops.jpg';
  const second = images[1] ?? fallback;
  const [slotImages, setSlotImages] = useState<[string, string]>(() => [fallback, second]);

  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const timer = setInterval(() => {
      setIndex(prevIndex => {
        const nextIndex = (prevIndex + 1) % images.length;
        const nextImage = images[nextIndex] ?? fallback;
        setActiveSlot(prevSlot => {
          const nextSlot = prevSlot === 0 ? 1 : 0;
          setSlotImages(prevSlots => {
            const nextSlots: [string, string] = [prevSlots[0], prevSlots[1]];
            nextSlots[nextSlot] = nextImage;
            return nextSlots;
          });
          return nextSlot;
        });
        return nextIndex;
      });
    }, HERO_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [images, fallback]);

  // Intelligent preloading: preload the upcoming image before it rotates in
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const upcomingIndex = (index + 1) % images.length;
    const upcoming = images[upcomingIndex];
    if (upcoming) {
      const preload = new Image();
      preload.src = upcoming;
    }
  }, [index, images]);

  return { activeSlot, slotImages };
}


function formatPrice(value: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
}

function SectionError({ title, message, retry }: { title: string; message: string; retry: () => void }) {
  return <div className={styles.sectionError} role="alert"><AlertCircle size={22} aria-hidden="true" /><div><h3>{title}</h3><p>{message}</p></div><Button type="button" variant="outline" onClick={retry}><RotateCcw size={16} aria-hidden="true" /> Retry</Button></div>;
}

function CategorySkeleton() {
  return <div className={styles.categorySkeleton} aria-hidden="true"><span /><span /><span /></div>;
}

export function HomePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [accountDeleted, setAccountDeleted] = useState(false);
  const arrivals = useProducts(new URLSearchParams({ pageSize: '6' }));
  const deals = useDeals(6);
  const categories = useCategories(true);
  const { activeSlot, slotImages } = useHeroRotation(HERO_IMAGES);

  useEffect(() => {
    if (location.state?.accountDeleted) {
      setAccountDeleted(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const frame = window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash]);

  return <div className={styles.home}>
    {accountDeleted && <Alert variant="success">Your account has been deleted.</Alert>}
    <HeroEntrance className={styles.hero}>
      <div className={styles.heroCopy}>
        <span data-hero-part="season" className={`${styles.eyebrow} ${styles.seasonBadge}`}>New Season 2026</span>
        <h1 data-hero-part="heading" id="home-title">Next-gen tech,<br /> delivered to you</h1>
        <p data-hero-part="subtitle">Shop the latest laptops, smartphones, audio, and more.</p>
        <div data-hero-part="actions" className={styles.heroActions}><Link className={styles.primaryLink} to="/products">Shop Now</Link><a className={styles.secondaryLink} href="#deals-title">Browse Deals</a></div>
      </div>
      <img
        src={slotImages[0]}
        alt=""
        aria-hidden="true"
        className={styles.heroBg}
        style={{ opacity: activeSlot === 0 ? 1 : 0 }}
        loading="eager"
      />
      <img
        src={slotImages[1]}
        alt=""
        aria-hidden="true"
        className={styles.heroBg}
        style={{ opacity: activeSlot === 1 ? 1 : 0 }}
        loading="lazy"
      />
    </HeroEntrance>

    <section className={styles.discoveryStrip} aria-label="Shopping benefits">
      <BenefitsReveal className={styles.benefitsGrid}>
        <StaggerItem className={styles.benefitItem}><Truck aria-hidden="true" /><span><strong>Free Delivery</strong><small>On orders over $99</small></span></StaggerItem>
        <StaggerItem className={styles.benefitItem} index={1}><ShieldCheck aria-hidden="true" /><span><strong>2-Year Warranty</strong><small>On all products</small></span></StaggerItem>
        <StaggerItem className={styles.benefitItem} index={2}><Zap aria-hidden="true" /><span><strong>24/7 Support</strong><small>We're always here</small></span></StaggerItem>
      </BenefitsReveal>
    </section>

    <section className={`${styles.section} ${styles.categorySection}`} aria-labelledby="categories-title">
      <SectionReveal replay className={styles.sectionHeading}><div><p className={styles.eyebrow}>Find your fit</p><h2 id="categories-title">Shop by Category</h2></div><Link to="/products">Browse all →</Link></SectionReveal>
      {categories.isPending && <div role="status" aria-label="Loading categories" className={styles.categoryGrid}>{Array.from({ length: 6 }, (_, index) => <CategorySkeleton key={index} />)}</div>}
      {categories.isError && !categories.data && <SectionError title="Unable to load categories" message="Please try again in a moment." retry={() => void categories.refetch()} />}
      {categories.data && <StaggerContainer replay className={styles.categoryGrid}>{categories.data.slice(0, 6).map((category, index) => <StaggerItem key={category.id} index={index}><CategoryCard category={category} /></StaggerItem>)}</StaggerContainer>}
    </section>

    <section className={styles.section} aria-labelledby="deals-title">
      <SectionReveal replay className={styles.sectionHeading}><div><p className={styles.eyebrow}>Worth a look</p><h2 id="deals-title">Featured Deals</h2></div><Link to="/products?sort=price-asc">Shop products →</Link></SectionReveal>
      {deals.isPending && <div role="status" aria-label="Loading deals" className={styles.productGrid}>{Array.from({ length: 6 }, (_, index) => <ProductCardSkeleton key={index} />)}</div>}
      {deals.isError && !deals.data && <SectionError title="Unable to load deals" message="Today's deals couldn't be loaded." retry={() => void deals.refetch()} />}
      {deals.data && <StaggerContainer replay className={styles.productGrid}>{deals.data.data.map((product, index) => <StaggerItem key={product.id} index={index}><ProductCard {...productCardProps(product)} onNavigate={navigate} /></StaggerItem>)}</StaggerContainer>}
      {deals.data?.data.length === 0 && <p>No deals are available right now.</p>}
    </section>
    <section className={styles.promoGrid} aria-label="Explore electronics">
      {deals.isPending && Array.from({ length: 2 }, (_, index) => <div key={index} className={styles.promoSkeleton} aria-hidden="true"><span /><span /><span /></div>)}
      {deals.data?.data.slice(0, 2).map((product, index) => <SectionReveal replay key={product.id}><article className={styles.promoCard}>
        <div><p className={styles.eyebrow}>{index === 0 ? 'Limited time' : 'Featured deal'}</p><h2>{product.name}</h2>
          <p>Now {formatPrice(product.price)}</p><Link to={`/products/${encodeURIComponent(product.slug)}`}>Shop now <span aria-hidden="true">→</span></Link></div>
        {product.primaryImage && <img src={product.primaryImage.url} alt="" loading="lazy" />}
      </article></SectionReveal>)}
    </section>
    <section className={styles.section} aria-labelledby="new-arrivals-title">
      <SectionReveal replay className={styles.sectionHeading}><div><p className={styles.eyebrow}>Just arrived</p><h2 id="new-arrivals-title">New Arrivals</h2></div><Link to="/products">View all products →</Link></SectionReveal>
      {arrivals.isPending && <div role="status" aria-label="Loading new arrivals" className={styles.productGrid}>{Array.from({ length: 6 }, (_, index) => <ProductCardSkeleton key={index} />)}</div>}
      {arrivals.isError && !arrivals.data && <SectionError title="Unable to load new arrivals" message="We couldn't load the latest products right now." retry={() => void arrivals.refetch()} />}
      {arrivals.data && <StaggerContainer replay className={styles.productGrid}>{arrivals.data.data.map((product, index) => <StaggerItem key={product.id} index={index}><ProductCard {...productCardProps(product)} onNavigate={navigate} /></StaggerItem>)}</StaggerContainer>}
      {arrivals.data?.data.length === 0 && <p>No products are available yet.</p>}
    </section>
  </div>;
}
