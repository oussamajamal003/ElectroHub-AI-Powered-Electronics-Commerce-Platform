import { railCopy } from '../labels';
import { recordRecommendationClick } from '../queries';
import { useImpressionTracking } from '../tracking';
import { useStoreCardActions } from '../useStoreCardActions';
import type { RecommendationSection } from '../types';
import { RecommendationRail, type RecommendationRailProps } from './RecommendationRail';

interface Props extends Pick<RecommendationRailProps, 'id' | 'columns' | 'headingLevel' | 'skeletonCount' | 'action' | 'onRetry'> {
  section?: RecommendationSection;
  loading?: boolean;
  error?: boolean;
  /** Heading while nothing is loaded yet, only when it is certain to be the final one; omit it when the server's strategy decides the heading (the skeleton is then headingless). */
  loadingTitle?: string;
  /** Also record the click in the signed-in, consenting customer's own activity (server re-checks consent). */
  recordPersonalClicks?: boolean;
}

/** Renders one server section with truthful copy, real cart/wishlist actions and viewability/click attribution. */
export function RecommendationSectionRail({ section, loading, error, loadingTitle, recordPersonalClicks = false, ...rail }: Props) {
  const { navigate, cardActions } = useStoreCardActions();
  const tracking = useImpressionTracking(section?.impressionToken ?? null);
  const copy = section ? railCopy(section) : null;

  if (section && !copy) return null;
  if (!section && !loading && !error) return null;

  return <RecommendationRail {...rail} {...cardActions}
    title={copy?.title ?? loadingTitle ?? (loading ? undefined : 'Recommendations')} description={copy?.description && section?.isPersonalized && section.fallbackReason === 'AI_UNAVAILABLE'
      ? `${copy.description} Recommendations are temporarily unavailable; showing your last personalized results.`
      : copy?.description}
    products={section?.items.map(item => item.product) ?? []} loading={loading} error={error}
    cardRef={tracking.observe}
    onNavigate={(href, product) => {
      // Navigation first; attribution is fire-and-forget and can never delay or block it.
      navigate(href);
      tracking.click(product.id);
      if (recordPersonalClicks && section) recordRecommendationClick(product.id, section.surface);
    }} />;
}
