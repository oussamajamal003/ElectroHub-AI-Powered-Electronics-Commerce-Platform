import { FileText, ListChecks } from 'lucide-react';
import { Rating } from '@/components/ui/Rating/Rating';
import type { ProductDetail, ReviewSummary } from '@/features/products/types';
import styles from './ProductDetailPage.module.scss';

/** Splits stored plain text on blank lines. Rendered as React text only: markup in a description is never interpreted. */
function descriptionParagraphs(text: string | null | undefined) {
  return (text ?? '').split(/\r?\n[ \t]*\r?\n/).map(paragraph => paragraph.trim()).filter(Boolean);
}

const HIGHLIGHT_LIMIT = 4;

/** Task 06.2 WP C: premium Description tab. Every value shown comes from the Product record; nothing is inferred. */
export function ProductDescriptionPanel({ product }: { product: ProductDetail }) {
  const paragraphs = descriptionParagraphs(product.description);
  const specificationItems = product.specifications.flatMap(group => group.items);
  const highlights = specificationItems.slice(0, HIGHLIGHT_LIMIT);
  const facts = [
    { label: 'Category', value: product.category.name },
    ...(product.brand ? [{ label: 'Brand', value: product.brand.name }] : []),
    { label: 'SKU', value: product.sku },
    ...(product.modelNumber ? [{ label: 'Model', value: product.modelNumber }] : []),
  ];

  return <section className={styles.descriptionPanel} aria-labelledby="product-description-title">
    <div className={styles.descriptionBody}>
      <h2 id="product-description-title">Product Description</h2>
      {paragraphs.length > 0
        ? paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)
        : <div className={styles.descriptionEmpty}><span className={styles.cardIcon} aria-hidden="true"><FileText size={20} /></span><p>No description is available.</p></div>}
    </div>
    <aside className={styles.glanceCard} aria-labelledby="product-glance-title">
      <h3 id="product-glance-title"><span className={styles.cardIcon} aria-hidden="true"><ListChecks size={20} /></span>At a glance</h3>
      <dl className={styles.glanceList}>
        {facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      </dl>
      {highlights.length > 0 && <>
        <h4>From the specifications</h4>
        <dl className={styles.glanceList} data-testid="description-highlights">
          {highlights.map(item => <div key={item.id}><dt>{item.name}</dt><dd>{item.value}</dd></div>)}
        </dl>
        {specificationItems.length > HIGHLIGHT_LIMIT && <p className={styles.glanceMore}>{specificationItems.length - HIGHLIGHT_LIMIT} more in the Specifications tab.</p>}
      </>}
    </aside>
  </section>;
}

const reviewWord = (count: number) => (count === 1 ? 'review' : 'reviews');

/**
 * Task 06.2 WP C: rating summary card. The distribution is drawn only from the server's per-star counts and only when they
 * are present and consistent with the review count, so a bar is never estimated from the average.
 */
export function ReviewSummaryCard({ summary }: { summary: ReviewSummary }) {
  const { averageRating, reviewCount, distribution } = summary;
  const rated = averageRating !== null && reviewCount > 0;
  const rows = rated && distribution && distribution.length === 5
    && distribution.reduce((sum, row) => sum + row.count, 0) === reviewCount
    ? [...distribution].sort((left, right) => right.rating - left.rating) : null;

  return <div className={styles.reviewSummary} data-testid="review-summary">
    <div className={styles.reviewScore}>
      {rated ? <>
        <p className={styles.reviewAverage}><strong>{averageRating}</strong><span>out of 5</span></p>
        <Rating value={Number(averageRating)} reviewCount={reviewCount} showLabel={false} className={styles.reviewStars} />
        <p className={styles.reviewTotal}>Based on {reviewCount} {reviewWord(reviewCount)}</p>
      </> : <>
        <p className={styles.reviewAverageEmpty}>No ratings yet</p>
        <p className={styles.reviewTotal}>Ratings appear here once customers review this product.</p>
      </>}
    </div>
    {rows && <ul className={styles.distribution} aria-label="Rating distribution">
      {rows.map(row => {
        const percent = Math.round((row.count / reviewCount) * 100);
        return <li key={row.rating}>
          <span className={styles.srOnly}>{row.rating} {row.rating === 1 ? 'star' : 'stars'}: {row.count} {reviewWord(row.count)}, {percent}%</span>
          <span aria-hidden="true" className={styles.distributionLabel}>{row.rating} ★</span>
          <span aria-hidden="true" className={styles.distributionBar}><span style={{ width: `${percent}%` }} /></span>
          <span aria-hidden="true" className={styles.distributionCount}>{row.count}</span>
        </li>;
      })}
    </ul>}
  </div>;
}
