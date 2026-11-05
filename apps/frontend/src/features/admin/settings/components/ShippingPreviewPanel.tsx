import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryProblem } from '@/features/admin/shared/AdminUi';
import styles from '@/features/admin/shared/AdminPages.module.scss';
import settingsStyles from './SettingsForms.module.scss';
import { useShippingPreview } from '../api';

const SUBTOTAL = /^\d{1,7}(\.\d{1,2})?$/;

/**
 * Quotes for a subtotal, computed by the server with the same calculation checkout uses. It reads the SAVED configuration, so
 * unsaved edits in the forms above do not change these numbers until they are saved.
 */
export function ShippingPreviewPanel() {
  const [input, setInput] = useState('');
  const [subtotal, setSubtotal] = useState<string | null>(null);
  const trimmed = input.trim();
  const valid = SUBTOTAL.test(trimmed);
  const preview = useShippingPreview(subtotal);

  const check = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (valid) setSubtotal(trimmed);
  };

  return <section className={styles.panel} aria-labelledby="shipping-preview-title">
    <div className={styles.panelHeader}>
      <h2 id="shipping-preview-title" className={styles.panelTitle}>Check quotes</h2>
    </div>
    <p className={styles.panelHint}>Shows what checkout would charge for a subtotal, using the saved rates and threshold.</p>
    <form className={settingsStyles.quoteForm} onSubmit={check} noValidate aria-label="Quote preview">
      <Input label="Cart subtotal ($)" inputMode="decimal" value={input} placeholder="49.99" maxLength={10}
        error={input && !valid ? 'Enter a subtotal such as 49.99.' : undefined}
        onChange={event => { setInput(event.target.value); setSubtotal(null); }} />
      <Button type="submit" variant="outline" disabled={!valid}>Check quotes</Button>
    </form>
    {subtotal !== null && preview.isPending && <div aria-busy="true" aria-label="Loading quotes"><Skeleton height={48} /></div>}
    {subtotal !== null && preview.isError && <QueryProblem error={preview.error} hasData={false} onRetry={() => void preview.refetch()}
      retrying={preview.isFetching} what="quotes" />}
    {subtotal !== null && preview.data && (preview.data.methods.length === 0
      ? <p className={styles.notice}>No delivery method is enabled. Checkout cannot offer shipping until one is.</p>
      : <ul className={settingsStyles.previewList} aria-label={`Quotes for $${preview.data.subtotal}`}>
        {preview.data.methods.map(quote => <li key={quote.id}>
          <span>
            <strong>{quote.label}</strong>
            <span className={styles.fieldHelp}> · {quote.estimate}</span>
          </span>
          <span className={settingsStyles.previewPrice}>{quote.price === '0.00' ? 'Free' : `$${quote.price}`}</span>
        </li>)}
      </ul>)}
  </section>;
}
