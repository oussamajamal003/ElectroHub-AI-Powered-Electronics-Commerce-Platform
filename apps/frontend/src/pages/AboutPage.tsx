import { Link } from 'react-router-dom';
import { Award, Headphones, PackageCheck, ShieldCheck, Sparkles, Truck, Zap } from 'lucide-react';
import { SectionReveal, StaggerContainer, StaggerItem } from '@/components/motion/Motion';
import styles from './CompanyPages.module.scss';

const offers = [
  { title: 'Latest Electronics', text: 'Explore current laptops, phones, audio, and everyday tech.', icon: PackageCheck },
  { title: 'Trusted Shopping Experience', text: 'Browse clear product information and shop with confidence.', icon: ShieldCheck },
  { title: 'Fast Delivery', text: 'Choose products with a convenient delivery experience.', icon: Truck },
  { title: 'Customer Support', text: 'Find help when you need guidance with your order.', icon: Headphones },
];

const values = [
  { title: 'Quality', text: 'Carefully curated electronics tested for durability and everyday performance.', icon: Award },
  { title: 'Simplicity', text: 'Intuitive shopping, clear specifications, and transparent details with zero clutter.', icon: Sparkles },
  { title: 'Trust', text: 'Dependable service, secure checkout, and reliable support whenever you need it.', icon: ShieldCheck },
  { title: 'Innovation', text: 'Bringing you the newest technologies and next-generation smart devices.', icon: Zap },
];

export function AboutPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1>Technology made simple.</h1>
        <p>ElectroHub brings useful electronics together in one clear, easy shopping experience.</p>
      </section>
      <div className={styles.content}>
        <SectionReveal className={styles.intro}>
          <h2>Who we are</h2>
          <p>
            ElectroHub is a destination for discovering electronics that fit your everyday life.
            We focus on making it easier to explore products, compare choices, and find what works for you.
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

        <section className={styles.section} aria-labelledby="why-title">
          <SectionReveal>
            <h2 id="why-title">Why ElectroHub</h2>
          </SectionReveal>
          <StaggerContainer className={styles.grid}>
            {['Wide Product Selection', 'Secure Shopping', 'Responsive Support', 'Modern Shopping Experience'].map((title, index) => (
              <StaggerItem key={title} index={index}>
                <article className={styles.card}>
                  <h3>{title}</h3>
                  <p>
                    {[
                      'Find a range of electronics in one place.',
                      'Shop through a clear, dependable experience.',
                      'Get guidance when questions come up.',
                      'Discover products with an easy-to-use storefront.',
                    ][index]}
                  </p>
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
          <p>Explore our wide selection of certified electronics with fast shipping and expert support.</p>
          <div className={styles.ctaButtonWrapper}>
            <Link to="/products" className={styles.ctaButton}>
              Explore Products
            </Link>
          </div>
        </SectionReveal>
      </div>
    </div>
  );
}
