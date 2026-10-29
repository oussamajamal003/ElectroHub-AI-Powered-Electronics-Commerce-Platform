import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClearRecentlyViewed, useRecentlyViewed, useRecommendationPreferences, useSetRecommendationPreferences } from '../queries';
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
  const recent = useRecentlyViewed(userId, 8);
  const clear = useClearRecentlyViewed(userId);
  const [message, setMessage] = useState('');
  const { navigate, cardActions } = useStoreCardActions();
  const enabled = preferences.data?.data.personalizationEnabled ?? false;

  const toggle = (next: boolean) => {
    setMessage('');
    update.mutate(next, {
      onSuccess: () => setMessage(next ? 'Personalized recommendations are on.' : 'Personalized recommendations are off and your activity history was deleted.'),
      onError: () => setMessage('Your preference could not be saved. Please try again.'),
    });
  };
  const clearHistory = () => {
    setMessage('');
    clear.mutate(undefined, {
      onSuccess: () => setMessage('Your recently viewed products were cleared.'),
      onError: () => setMessage('Recently viewed products could not be cleared. Please try again.'),
    });
  };
  const items = recent.data?.data.items ?? [];

  return <section className={styles.panel} aria-labelledby="personalization-title">
    <div className={styles.settings}>
      <div>
        <h2 id="personalization-title">Personalized recommendations</h2>
        <p id="personalization-description">Use the products you view, save, add to cart and buy on ElectroHub to recommend products for you.
          We keep this activity for up to 90 days. Turning this off deletes it.</p>
      </div>
      {preferences.isPending ? <Skeleton width={44} height={24} /> :
        <Switch checked={enabled} disabled={update.isPending || preferences.isError} onCheckedChange={toggle}
          aria-labelledby="personalization-title" aria-describedby="personalization-description" />}
    </div>
    {preferences.isError && <p role="alert" className={styles.message}>Your preference could not be loaded.
      <Button type="button" variant="ghost" onClick={() => void preferences.refetch()}>Retry</Button></p>}
    {message && <p role="status" className={styles.message}>{message}</p>}

    {enabled && <div className={styles.recent}>
      {recent.isPending && <RecommendationRail id="recently-viewed-title" headingLevel="h3" title="Recently Viewed" products={[]} loading />}
      {recent.isError && !recent.data && <RecommendationRail id="recently-viewed-title" headingLevel="h3" title="Recently Viewed" products={[]}
        error onRetry={() => void recent.refetch()} />}
      {recent.data && items.length === 0 && <div className={styles.empty}><h3>Recently Viewed</h3><p>Products you open will appear here.</p></div>}
      {/* History, not a recommendation: plain rail, no ranking claim and no attribution tracking. */}
      {items.length > 0 && <RecommendationRail id="recently-viewed-title" headingLevel="h3" title="Recently Viewed"
        description="Your own history, newest first." products={items} {...cardActions} onNavigate={href => navigate(href)} />}
      {items.length > 0 && <Button type="button" variant="outline" isLoading={clear.isPending} onClick={clearHistory}>Clear recently viewed</Button>}
    </div>}
  </section>;
}
