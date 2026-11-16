import { Check } from 'lucide-react';
import { formatStamp, stageIndex, stageTimes, STAGES } from '../presentation';
import type { DeliveryTimelineEntry } from '../types';
import styles from '../Delivery.module.scss';

/**
 * Four-stage progress from the canonical Order.status. Times appear only for stages a DeliveryEvent actually recorded; Delivered is
 * final, so it is both completed and current.
 */
export function DeliveryProgressStepper({ status, timeline }: { status: string; timeline: DeliveryTimelineEntry[] }) {
  const current = stageIndex(status);
  const final = current === STAGES.length - 1;
  const times = stageTimes(timeline);
  return <section className={styles.card} aria-labelledby="delivery-progress-heading">
    <div className={styles.cardHead}><h2 id="delivery-progress-heading">Delivery progress</h2><span className={styles.sub}>Step {current + 1} of 4</span></div>
    <ol className={styles.steps}>
      {STAGES.map((stage, position) => {
        const done = position < current || (final && position === current);
        const isCurrent = position === current;
        const word = done ? 'Completed' : isCurrent ? 'Current' : 'Upcoming';
        const className = [styles.step, done && styles.stepDone, isCurrent && styles.stepCurrent, final && isCurrent && styles.stepFinal,
          !done && !isCurrent && styles.stepFuture].filter(Boolean).join(' ');
        const Icon = stage.icon;
        const time = times[stage.key];
        return <li key={stage.key} className={className} aria-current={isCurrent ? 'step' : undefined}>
          <span className={styles.node}><Icon aria-hidden="true" />{done && <span className={styles.tick}><Check aria-hidden="true" /></span>}</span>
          <span className={styles.stepText}>
            <span className={styles.stepLabel}>{stage.label}</span>
            <span className={styles.stepState}>{word}</span>
            {time && <time className={styles.stepTime} dateTime={time}>{formatStamp(time)}</time>}
          </span>
        </li>;
      })}
    </ol>
  </section>;
}
