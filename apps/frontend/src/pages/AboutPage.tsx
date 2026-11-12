import { Link } from 'react-router-dom';
import { ArrowRight, Award, Headphones, PackageCheck, ScanSearch, ShieldCheck, Sparkles, Truck } from 'lucide-react';
import { SectionReveal, StaggerContainer, StaggerItem } from '@/components/motion/Motion';
import styles from './CompanyPages.module.scss';

const offers = [
  { title: 'Electronics in one place', text: 'Browse laptops, phones, audio and everyday tech with clear product information and photos.', icon: PackageCheck },
  { title: 'Find it your way', text: 'Search by keyword, filter the catalog, or search with a photo to find similar products.', icon: ScanSearch },
  { title: 'Checkout and tracking', text: 'Pay securely with Stripe, follow your order status and, when it is on its way, track the delivery on a map.', icon: Truck },
  { title: 'Help from our team', text: 'Questions about an order or a product? Send us a message and we will reply by email.', icon: Headphones },
];

const aiFeatures = [
  { title: 'Recommendations', text: 'Suggestions built from how products are viewed and bought together, shown alongside the products you browse.', icon: Sparkles },
  { title: 'Image search', text: 'Upload a photo of a device or accessory and see visually similar products from our catalog.', icon: ScanSearch },
];

const values = [
  { title: 'Clarity', text: 'Specifications, prices and availability are shown plainly, with no clutter between you and the product.', icon: Sparkles },
  { title: 'Trust', text: 'Prices, stock and payment state are always confirmed by our servers, never taken on faith from your browser.', icon: ShieldCheck },
  { title: 'Privacy', text: 'We ask for the details an order needs, and keep payment card data with our payment provider.', icon: Award },
  { title: 'Care', text: 'Messages sent through our contact form go straight to our support team.', icon: Headphones },
];

export function AboutPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero} onPointerMove={event => {
        // Spotlight follows the pointer; purely decorative, so it is skipped for reduced-motion users.
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
        event.currentTarget.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
      }}>
        <h1>Technology made simple.</h1>
        <p>ElectroHub brings useful electronics together in one clear, easy shopping experience.</p>
      </section>
      <div className={styles.content}>
        <SectionReveal className={styles.intro}>
          <h2>Who we are</h2>
          <p>
            ElectroHub is an online store for electronics. We focus on making it easier to explore products,
            compare choices, and find what works for you.
          </p>
        </SectionReveal>

        <section className={styles.section} aria-labelledby="offer-title">
          <SectionReveal>
            <h2 id="offer-title">What we offer</h2>
          </SectionReveal>
          <StaggerContainer className={styles.grid}>
            {offers.map(({ title, text, icon: Icon }, index) => (
              <StaggerItem key={title} index={index}>
                <article className={styles.card}>
                  <div className={styles.iconWrapper}>
                    <Icon aria-hidden="true" size={24} />
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </section>

        <section className={styles.section} aria-labelledby="ai-title">
          <SectionReveal>
            <h2 id="ai-title">Smarter shopping, assisted by AI</h2>
          </SectionReveal>
          <StaggerContainer className={styles.gridTwo}>
            {aiFeatures.map(({ title, text, icon: Icon }, index) => (
              <StaggerItem key={title} index={index}>
                <article className={styles.card}>
                  <div className={styles.iconWrapper}>
                    <Icon aria-hidden="true" size={24} />
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </section>

        <section className={styles.section} aria-labelledby="values-title">
          <SectionReveal>
            <h2 id="values-title">Our values</h2>
          </SectionReveal>
          <StaggerContainer className={styles.grid}>
            {values.map(({ title, text, icon: Icon }, index) => (
              <StaggerItem key={title} index={index}>
                <article className={styles.card}>
                  <div className={styles.iconWrapper}>
                    <Icon aria-hidden="true" size={24} />
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </section>

        <SectionReveal className={styles.cta}>
          <h2>Find your next upgrade</h2>
          <p>Explore the catalog, or get in touch if you would like help choosing.</p>
          <div className={styles.ctaButtonWrapper}>
            <Link to="/products" className={styles.ctaButton}>
              Explore Products
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link to="/contact" className={styles.ctaSecondary}>Contact us</Link>
          </div>
        </SectionReveal>
      </div>
    </div>
  );
}
