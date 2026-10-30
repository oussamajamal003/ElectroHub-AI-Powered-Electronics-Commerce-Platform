import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClearRecentlyViewed, useRecentlyViewed, useRecommendationPreferences, useRemoveRecentlyViewed, useSetRecommendationPreferences } from '../queries';
import { useStoreCardActions } from '../useStoreCardActions';
import { RecommendationRail } from './RecommendationRail';
import styles from './PersonalizationPanel.module.scss';

/**
 * Task 04.4 account controls: explicit opt-in for personalized recommendations (off by default), and the customer's
 * own Recently Viewed list with a clear action. Turning personalization off also erases the activity it used.
 */
export function PersonalizationPanel({ userId }: { userId: string }) {
  const preferences = useRecommendationPreferences(userId);
  const update = useSetRecommendationPreferences(userId);
  const enabled = preferences.data?.data.personalizationEnabled ?? false;
  const recent = useRecentlyViewed(userId, 8, enabled);
  const clear = useClearRecentlyViewed(userId);
  const remove = useRemoveRecentlyViewed(userId);
  const [message, setMessage] = useState('');
  const [preferenceError, setPreferenceError] = useState('');
  const preferenceRequestLocked = useRef(false);
  const clearing = useRef(false);
  const emptyHeading = useRef<HTMLHeadingElement>(null);
  const { navigate, cardActions } = useStoreCardActions();

  const toggle = (next: boolean) => {
    if (preferenceRequestLocked.current || update.isPending || preferences.isError || (enabled && recent.isPending)) return;
    preferenceRequestLocked.current = true;
    setMessage('');
    setPreferenceError('');
    update.mutate(next, {
      onSuccess: () => {
        preferenceRequestLocked.current = false;
        setMessage(next ? 'Personalized recommendations are on.' : 'Personalized recommendations are off and your activity history was deleted.');
      },
      onError: () => {
        preferenceRequestLocked.current = false;
        setPreferenceError('Your preference could not be saved. Please try again.');
      },
    });
  };
  const items = recent.data?.data.items ?? [];
  // The focused Clear button unmounts, and the rail's height collapses with it. The browser clamps the scroll position to the
  // new document end, so the viewport lands at the page footer. Move focus to the empty-state heading before paint: focus
  // scrolls it into view, which keeps the viewport on the Recently Viewed section instead of the document end.
  useLayoutEffect(() => {
    if (clearing.current && items.length === 0) emptyHeading.current?.focus();
  }, [items.length]);
  const clearHistory = () => {
    setMessage('');
    clearing.current = true;
    clear.mutate(undefined, {
      onSuccess: () => { clearing.current = false; setMessage('Your recently viewed products were cleared.'); },
      onError: () => { clearing.current = false; setMessage('Recently viewed products could not be cleared. Please try again.'); },
    });
  };

  return <section className={styles.panel} aria-labelledby="personalization-title">
    <div className={styles.settings}>
      <div>
        <h2 id="personalization-title">Personalized recommendations</h2>
        <p id="personalization-description">Use the products you view, save, add to cart and buy on ElectroHub to recommend products for you.
          We keep this activity for up to 90 days. Turning this off deletes it.</p>
      </div>
      {preferences.isPending ? <Skeleton width={44} height={24} /> :
        <div className={styles.preferenceControl}>
          <Switch checked={enabled} disabled={preferences.isError || (enabled && !update.isPending && recent.isPending)} onCheckedChange={toggle}
            aria-labelledby="personalization-title"
            aria-describedby={preferenceError ? 'personalization-description preference-save-error' : 'personalization-description'} />
        </div>}
    </div>
    {preferences.isError && <p role="alert" className={styles.message}>Your preference could not be loaded.
      <Button type="button" variant="ghost" onClick={() => void preferences.refetch()}>Retry</Button></p>}
    {preferenceError && <p id="preference-save-error" role="alert" className={styles.message}>{preferenceError}</p>}
    {message && <p role="status" className={styles.message}>{message}</p>}

    {enabled && <div className={styles.recent}>
      {recent.isPending && <RecommendationRail id="recently-viewed-title" headingLevel="h3" title="Recently Viewed" products={[]} loading skeletonCount={8} />}
      {recent.isError && !recent.data && <RecommendationRail id="recently-viewed-title" headingLevel="h3" title="Recently Viewed" products={[]}
        error onRetry={() => void recent.refetch()} />}
      {recent.data && items.length === 0 && <div className={styles.empty}><h3 ref={emptyHeading} tabIndex={-1}>Recently Viewed</h3><p>Products you open will appear here.</p></div>}
      {/* History, not a recommendation: plain rail, no ranking claim and no attribution tracking. */}
      {items.length > 0 && <RecommendationRail id="recently-viewed-title" headingLevel="h3" title="Recently Viewed"
        description="Your own history, newest first. Removing views deletes view activity only; wishlist, cart and purchase signals remain until you turn personalization off." products={items} {...cardActions} onNavigate={href => navigate(href)}
        onRemove={productId => {
          setMessage('');
          remove.mutate(productId, {
            onSuccess: () => setMessage('Product removed from recently viewed.'),
            onError: () => setMessage('This product could not be removed. Please try again.'),
          });
        }} removeDisabled={remove.isPending || clear.isPending} />}
      {items.length > 0 && <Button type="button" variant="outline" isLoading={clear.isPending} disabled={remove.isPending || clear.isPending} onClick={clearHistory}>Clear recently viewed</Button>}
    </div>}
  </section>;
}
