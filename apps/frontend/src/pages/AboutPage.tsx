import { Link } from 'react-router-dom';
import { ArrowRight, Headphones, LayoutGrid, ListChecks, LockKeyhole, Search, ShieldCheck, Sparkles, Truck } from 'lucide-react';
import { SectionReveal, StaggerContainer, StaggerItem } from '@/components/motion/Motion';
import styles from './CompanyPages.module.scss';

/**
 * About Us (Task 06.2 WP A). Copy describes only what the storefront actually does (catalog, search, product specifications,
 * reviews, Stripe checkout, delivery options chosen at checkout, the contact form); no invented figures, awards or certifications.
 * Imagery: project-owned, unbranded studio photographs (public/images/about, see the README there), served as AVIF/WebP.
 */
type AboutImageName = 'laptop' | 'headphones' | 'smartwatch' | 'smartphone' | 'monitor' | 'tablet' | 'console' | 'charging-dock' | 'laptop-closed';

function AboutImage({ name, alt, sizes, priority = false, className }: { name: AboutImageName; alt: string; sizes: string; priority?: boolean; className?: string }) {
  const set = (format: 'avif' | 'webp') => `/images/about/${name}-480.${format} 480w, /images/about/${name}-800.${format} 800w`;
  return <picture className={className}>
    <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
    <source type="image/webp" srcSet={set('webp')} sizes={sizes} />
    <img src={`/images/about/${name}-800.webp`} alt={alt} width={800} height={800} loading={priority ? 'eager' : 'lazy'} decoding="async"
      {...(priority ? { fetchPriority: 'high' as const } : {})} />
  </picture>;
}

const heroTiles: { name: AboutImageName; alt: string }[] = [
  { name: 'laptop', alt: 'Open laptop with a blue abstract wallpaper' },
  { name: 'headphones', alt: 'Black over-ear wireless headphones' },
  { name: 'smartwatch', alt: 'Smartwatch with a black sport band' },
  { name: 'smartphone', alt: 'Smartphone shown from the front and the back' },
];

const offers = [
  { title: 'A focused catalog', text: 'Phones, laptops, tablets, audio, wearables, monitors, gaming and accessories, organised by category and brand.', icon: LayoutGrid },
  { title: 'Search that helps you decide', text: 'Filter by category, brand, price and availability, then sort by what matters to you.', icon: Search },
  { title: 'Details before you buy', text: 'Specifications, stock status and customer reviews on every product page.', icon: ListChecks },
  { title: 'Secure checkout', text: 'Card payments are handled by Stripe; card details never touch our servers.', icon: LockKeyhole },
];

const range: { name: AboutImageName; title: string; alt: string }[] = [
  { name: 'monitor', title: 'Monitors', alt: 'Slim desktop monitor on a metal stand' },
  { name: 'tablet', title: 'Tablets', alt: 'Silver tablet with a light blue wallpaper' },
  { name: 'console', title: 'Gaming', alt: 'White games console standing upright next to its controller' },
  { name: 'charging-dock', title: 'Accessories', alt: 'Charging dock holding a phone, a watch and earbuds' },
];

const values = [
  { title: 'Clarity', text: 'Prices, availability and delivery options are shown before you commit, not after.', icon: Sparkles },
  { title: 'Honesty', text: 'Star ratings are calculated from the reviews customers leave, and specifications come from the product data.', icon: ShieldCheck },
  { title: 'Choice', text: 'At checkout, every delivery option available for your order shows its price and estimated arrival.', icon: Truck },
  { title: 'Help when you need it', text: 'Questions about an order or a product? Our contact form reaches the support team directly.', icon: Headphones },
];

export function AboutPage() {
  return (
    <div className={styles.page}>
      <section className={`${styles.hero} ${styles.aboutHero}`} aria-labelledby="about-title">
        <div className={styles.aboutHeroCopy}>
          <p className={styles.eyebrow}>About ElectroHub</p>
          <h1 id="about-title">Technology made simple.</h1>
          <p>ElectroHub brings useful electronics together in one clear, easy shopping experience: compare the details, choose with confidence, and check out securely.</p>
          <div className={styles.heroActions}>
            <Link to="/products" className={styles.heroPrimary}>Browse products<ArrowRight aria-hidden="true" size={18} /></Link>
            <Link to="/contact" className={styles.heroSecondary}>Contact us</Link>
          </div>
        </div>
        <div className={styles.heroMosaic}>
          {heroTiles.map((tile, index) => <AboutImage key={tile.name} className={styles.mosaicTile} name={tile.name} alt={tile.alt}
            priority={index < 2} sizes="(min-width: 1024px) 18rem, (min-width: 640px) 40vw, 45vw" />)}
        </div>
      </section>

      <div className={styles.content}>
        <SectionReveal className={styles.story}>
          <AboutImage className={styles.storyImage} name="laptop-closed" alt="Closed space-grey laptop seen from the side" sizes="(min-width: 1024px) 34rem, 100vw" />
          <div>
            <p className={styles.eyebrowDark}>Who we are</p>
            <h2>A calmer way to shop for electronics</h2>
            <p>
              ElectroHub is an online electronics store built around one idea: buying technology should feel straightforward.
              We keep product pages factual, put specifications and real customer reviews side by side, and show the full price,
              including delivery, before you pay.
            </p>
            <p>
              Whether you are replacing a phone or setting up a new desk, the catalog, search and recommendations are designed to
              help you find the right device quickly and understand what you are buying.
            </p>
          </div>
        </SectionReveal>

        <section className={styles.section} aria-labelledby="offer-title">
          <SectionReveal><h2 id="offer-title">What we offer</h2></SectionReveal>
          <StaggerContainer className={styles.grid}>
            {offers.map(({ title, text, icon: Icon }, index) => (
              <StaggerItem key={title} index={index}>
                <article className={styles.card}>
                  <div className={styles.iconWrapper}><Icon aria-hidden="true" size={24} /></div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </section>

        <section className={styles.section} aria-labelledby="range-title">
          <SectionReveal>
            <h2 id="range-title">Across the range</h2>
            <p className={styles.sectionLead}>From everyday essentials to the centrepiece of your desk.</p>
          </SectionReveal>
          <StaggerContainer className={styles.rangeGrid}>
            {range.map(({ name, title, alt }, index) => (
              <StaggerItem key={name} index={index}>
                <figure className={styles.rangeItem}>
                  <AboutImage name={name} alt={alt} sizes="(min-width: 1024px) 18rem, (min-width: 640px) 45vw, 100vw" />
                  <figcaption>{title}</figcaption>
                </figure>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </section>

        <section className={styles.section} aria-labelledby="values-title">
          <SectionReveal><h2 id="values-title">What we stand for</h2></SectionReveal>
          <StaggerContainer className={styles.grid}>
            {values.map(({ title, text, icon: Icon }, index) => (
              <StaggerItem key={title} index={index}>
                <article className={styles.card}>
                  <div className={styles.iconWrapper}><Icon aria-hidden="true" size={24} /></div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </section>

        <SectionReveal className={styles.cta}>
          <h2>Find your next upgrade</h2>
          <p>Browse the catalog, compare specifications and reviews, and check out securely when you are ready.</p>
          <div className={styles.ctaButtonWrapper}>
            <Link to="/products" className={styles.ctaButton}>
              Explore Products
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          </div>
        </SectionReveal>
      </div>
    </div>
  );
}
