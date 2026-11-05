import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { errorMessage, fieldErrors } from '@/features/admin/shared/api';
import { useAdminToast } from '@/features/admin/shared/AdminUi';
import styles from '@/features/admin/shared/AdminPages.module.scss';
import { isVersionConflict, useUpdateShippingSettings, type ShippingMethodId, type ShippingView } from '../api';
import { SettingsConflictNotice } from './SettingsConflictNotice';
import settingsStyles from './SettingsForms.module.scss';

/** Labels follow the Shipping reference (docs/assets/figma/exports/admin/screenshots/Settings-page.png). Method ids are the server contract. */
const RATE_LABEL: Record<ShippingMethodId, string> = {
  STANDARD: 'Standard Shipping Rate ($)',
  EXPRESS: 'Express Shipping Rate ($)',
  OVERNIGHT: 'Overnight Shipping Rate ($)',
};
const ENABLE_LABEL: Record<ShippingMethodId, string> = {
  STANDARD: 'Enable standard delivery option',
  EXPRESS: 'Enable express delivery option',
  OVERNIGHT: 'Enable overnight delivery option',
};

interface MethodDraft { enabled: boolean; price: string }
interface ShippingDraft { thresholdOn: boolean; threshold: string; methods: Record<ShippingMethodId, MethodDraft> }

const toDraft = (view: ShippingView): ShippingDraft => ({
  thresholdOn: view.freeShippingThreshold !== null,
  threshold: view.freeShippingThreshold ?? '',
  methods: Object.fromEntries(view.methods.map(method => [method.method, { enabled: method.enabled, price: method.price }])) as Record<ShippingMethodId, MethodDraft>,
});

export function ShippingSettingsForm({ view, onDirtyChange, onSaved, onReload }: {
  view: ShippingView;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onReload: () => Promise<void>;
}) {
  const [baseline] = useState(() => toDraft(view));
  const [expectedVersion] = useState(view.version);
  const [draft, setDraft] = useState<ShippingDraft>(baseline);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const save = useUpdateShippingSettings();
  const toast = useAdminToast();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const clearError = (field: string) => setErrors(current => {
    if (!(field in current)) return current;
    const next = { ...current };
    delete next[field];
    return next;
  });
  const setMethod = (method: ShippingMethodId, patch: Partial<MethodDraft>) => {
    setDraft(current => ({ ...current, methods: { ...current.methods, [method]: { ...current.methods[method], ...patch } } }));
    const index = view.methods.findIndex(entry => entry.method === method);
    clearError(`methods.${index}.price`);
    clearError(`methods.${index}.enabled`);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setConflict(false);
    try {
      await save.mutateAsync({
        expectedVersion,
        freeShippingThreshold: draft.thresholdOn ? draft.threshold.trim() : null,
        methods: view.methods.map(entry => ({
          method: entry.method,
          enabled: draft.methods[entry.method].enabled,
          price: draft.methods[entry.method].price.trim(),
        })),
      });
      toast('Shipping settings saved');
      onSaved();
    } catch (error) {
      if (isVersionConflict(error)) { setConflict(true); return; }
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) { setErrors(fields); return; }
      setFormError(errorMessage(error, 'Shipping settings could not be saved. Try again.'));
    }
  };

  const rowError = (index: number, field: 'price' | 'enabled') => errors[`methods.${index}.${field}`];

  return <form className={styles.form} onSubmit={submit} noValidate aria-label="Shipping settings">
    {conflict && <SettingsConflictNotice subject="shipping settings" onReload={onReload} />}
    {formError && <p className={styles.formError} role="alert">{formError}</p>}
    {errors.methods && <p className={styles.formError} role="alert">{errors.methods}</p>}
    <div className={styles.fieldGrid}>
      <div className={styles.fieldFull}>
        <Input label="Free Shipping Threshold ($)" value={draft.threshold} disabled={!draft.thresholdOn} inputMode="decimal" fullWidth
          placeholder="50.00" error={errors.freeShippingThreshold}
          helperText="Applies to Standard delivery only. A subtotal at or above this amount ships Standard for free."
          onChange={event => { setDraft(current => ({ ...current, threshold: event.target.value })); clearError('freeShippingThreshold'); }} />
      </div>
      {view.methods.map((entry, index) => <div key={entry.method} className={styles.fieldFull}>
        <Input label={RATE_LABEL[entry.method]} value={draft.methods[entry.method].price} inputMode="decimal" fullWidth
          error={rowError(index, 'price')} helperText={`${entry.label}: ${entry.estimate}`}
          onChange={event => setMethod(entry.method, { price: event.target.value })} />
      </div>)}
    </div>
    <fieldset className={settingsStyles.group}>
      <legend className={styles.fieldLabel}>Delivery Options</legend>
      <label className={settingsStyles.option}>
        <Checkbox checked={draft.thresholdOn} onCheckedChange={checked => { setDraft(current => ({ ...current, thresholdOn: checked === true })); clearError('freeShippingThreshold'); }} />
        <span className={settingsStyles.optionText}>Enable free shipping for orders above threshold</span>
      </label>
      {view.methods.map((entry, index) => <label key={entry.method} className={settingsStyles.option}>
        <Checkbox checked={draft.methods[entry.method].enabled} onCheckedChange={checked => setMethod(entry.method, { enabled: checked === true })} />
        <span className={settingsStyles.optionText}>{ENABLE_LABEL[entry.method]}</span>
        {rowError(index, 'enabled') && <span className={styles.fieldError}>{rowError(index, 'enabled')}</span>}
      </label>)}
    </fieldset>
    <div className={styles.formActions}>
      <Button type="submit" isLoading={save.isPending} disabled={!dirty || save.isPending || conflict}>Save Shipping</Button>
    </div>
  </form>;
}
