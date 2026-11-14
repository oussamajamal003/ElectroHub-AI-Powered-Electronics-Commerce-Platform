import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Cookie, Globe2, History, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { openCookieSettings } from './consent';
import styles from './CookiePolicy.module.scss';

type PolicySectionId = 'essential-storage' | 'optional-analytics' | 'retention' | 'other-services' | 'your-choices';
const sections = [
  { id: 'essential-storage', title: 'Essential storage', icon: ShieldCheck },
  { id: 'optional-analytics', title: 'Optional analytics', icon: BarChart3 },
  { id: 'retention', title: 'Retention and earlier data', icon: History },
  { id: 'other-services', title: 'Other services', icon: Globe2 },
  { id: 'your-choices', title: 'Your choices', icon: SlidersHorizontal },
] as const;

function PolicySection({ id, children }: { id: PolicySectionId; children: ReactNode }) {
  const { title, icon: Icon } = sections.find(section => section.id === id)!;
  return <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className={styles.sectionTitle}><span className={styles.sectionIcon} aria-hidden="true"><Icon /></span>{title}</h2>
    {children}
  </section>;
}

/** Policy wording is unchanged from the previous page (Task 06.2 redesign is presentation only). */
export function CookiePolicy() {
  return <div className={styles.page}>
    <header className={styles.hero}>
      <span className={styles.heroIcon} aria-hidden="true"><Cookie /></span>
      <div className={styles.heroText}>
        <p className={styles.eyebrow}>Privacy</p>
        <h1>Cookie Policy</h1>
        <p className={styles.lead}>Cookies are small files stored by your browser. ElectroHub also uses browser local storage and session storage for similar purposes.</p>
      </div>
      <div className={styles.heroActions}>
        <Button type="button" variant="outline" onClick={openCookieSettings}><SlidersHorizontal aria-hidden="true" /> Manage preferences</Button>
      </div>
    </header>

    <div className={styles.layout}>
      <nav className={styles.toc} aria-label="On this page">
        <p className={styles.tocTitle}>On this page</p>
        <ol>
          {sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}
        </ol>
      </nav>

      <article className={styles.policy}>
        <PolicySection id="essential-storage">
          <p>We use security and sign-in cookies to keep customer and administrator sessions separate. They include <code>electrohub_customer_refresh</code> and <code>electrohub_admin_refresh</code> (up to seven days), <code>electrohub_google_transaction</code> (up to five minutes), <code>electrohub_google_transaction_completion</code> (30 seconds), and <code>electrohub_account_deletion_proof</code> (up to five minutes). They are used when you sign in, connect Google, or confirm account deletion. Signing out clears the relevant refresh cookie.</p>
          <p>Browser storage keeps your guest cart and wishlist, sign-in display information, checkout and payment recovery state, and requested interface settings. Local storage remains until removed by the application or browser; session storage normally lasts for the tab session. Clearing storage may disrupt these features.</p>
        </PolicySection>
        <PolicySection id="optional-analytics">
          <p>With your permission, ElectroHub uses a random per-tab identifier in session storage (<code>eh.storefront-session</code>) to measure visible storefront time. We also record recommendation impressions and clicks, and image-search outcomes and result selections. Signed-in customers can separately manage personalized recommendations in their account settings. These analytics help improve the service. They are first-party measurements; the choice is stored in <code>electrohub.privacy.v1</code> and expires for use after 180 days; the browser may retain the record until replaced or cleared. Rejecting or withdrawing consent stops new measurements and removes the tab identifier, in every open ElectroHub tab of this browser.</p>
          <p>If you withdraw while a photo search is still in progress, ElectroHub asks the server to discard that search&apos;s measurement; if it was already recorded, that record is erased. A search answered before you withdrew is not affected, and a result you select afterwards is not measured.</p>
        </PolicySection>
        <PolicySection id="retention">
          <p>Withdrawing consent does not delete analytics recorded before you withdrew. Recommendation impressions and clicks are kept for up to 90 days, and storefront-time and image-search measurements for up to 400 days, after which they are deleted automatically. To ask for earlier analytics to be deleted, <Link to="/contact">contact us</Link>.</p>
        </PolicySection>
        <PolicySection id="other-services">
          <p>The checkout page loads the payment script of our payment provider, Stripe, from js.stripe.com; Stripe may use its own storage for fraud prevention and security while you pay. When you use payment, Google sign-in, delivery maps or other external services, their providers may receive requests or use their own storage for those services and security. Their storage and lifetimes are controlled by those providers and may vary. Consult their policies and your browser settings for details.</p>
        </PolicySection>
        <PolicySection id="your-choices">
          <p>Use Cookie Settings in the footer to change or withdraw your analytics choice. You can also clear or block storage in your browser settings. Blocking essential storage may affect shopping and sign-in. For privacy questions, <Link to="/contact">contact us</Link>.</p>
          <div className={styles.callout}>
            <p>Review, change or withdraw your optional analytics choice.</p>
            <Button type="button" variant="outline" size="small" onClick={openCookieSettings}><SlidersHorizontal aria-hidden="true" /> Change preferences</Button>
          </div>
        </PolicySection>
      </article>
    </div>
  </div>;
}
