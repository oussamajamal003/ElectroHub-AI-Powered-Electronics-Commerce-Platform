import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { errorMessage, fieldErrors } from '@/features/admin/shared/api';
import { useAdminToast } from '@/features/admin/shared/AdminUi';
import styles from '@/features/admin/shared/AdminPages.module.scss';
import { isVersionConflict, useUpdateStoreSettings, type StoreProfile } from '../api';
import { SettingsConflictNotice } from './SettingsConflictNotice';

/** Editable text state: nullable server fields are held as '' and sent as '' (the server stores '' as null). */
type Draft = Record<'storeName' | 'supportEmail' | 'supportPhone' | 'addressLine1' | 'addressLine2' | 'city' | 'region' | 'postalCode' | 'country' | 'timezone', string>;

const toDraft = (profile: StoreProfile): Draft => ({
  storeName: profile.storeName,
  supportEmail: profile.supportEmail ?? '',
  supportPhone: profile.supportPhone ?? '',
  addressLine1: profile.addressLine1 ?? '',
  addressLine2: profile.addressLine2 ?? '',
  city: profile.city ?? '',
  region: profile.region ?? '',
  postalCode: profile.postalCode ?? '',
  country: profile.country ?? '',
  timezone: profile.timezone,
});

/**
 * IANA zones the browser knows (Intl.supportedValuesOf is ES2022 and not in this project's ES2020 lib, hence the narrow typed read),
 * plus UTC and the saved zone so the current value is always selectable.
 */
const supportedZones = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf?.('timeZone') ?? [];

export function StoreSettingsForm({ profile, onDirtyChange, onSaved, onReload }: {
  profile: StoreProfile;
  onDirtyChange: (dirty: boolean) => void;
  /** The saved profile is already in the cache; the page remounts the form from it. */
  onSaved: () => void;
  /** Fetches the latest profile and remounts the form with it. Used after another administrator saved first. */
  onReload: () => Promise<void>;
}) {
  // The parent remounts after save/reload. Background refetches must not advance a dirty draft's version.
  const [baseline] = useState(() => toDraft(profile));
  const [expectedVersion] = useState(profile.version);
  const timeZoneOptions = useMemo(
    () => [...new Set(['UTC', profile.timezone, ...supportedZones])].map(zone => ({ value: zone, label: zone })),
    [profile.timezone],
  );
  const [draft, setDraft] = useState<Draft>(baseline);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const save = useUpdateStoreSettings();
  const toast = useAdminToast();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const update = (field: keyof Draft, value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
    setErrors(current => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setConflict(false);
    try {
      await save.mutateAsync({ expectedVersion, ...draft });
      toast('Store settings saved');
      onSaved();
    } catch (error) {
      if (isVersionConflict(error)) { setConflict(true); return; }
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) { setErrors(fields); return; }
      setFormError(errorMessage(error, 'The store settings could not be saved. Try again.'));
    }
  };

  return <form className={styles.form} onSubmit={submit} noValidate aria-label="Store information">
    {conflict && <SettingsConflictNotice subject="settings" onReload={onReload} />}
    {formError && <p className={styles.formError} role="alert">{formError}</p>}
    <div className={styles.fieldGrid}>
      <Input label="Store name" value={draft.storeName} onChange={event => update('storeName', event.target.value)} error={errors.storeName}
        maxLength={120} fullWidth autoComplete="organization" />
      <Input label="Store email" type="email" value={draft.supportEmail} onChange={event => update('supportEmail', event.target.value)}
        error={errors.supportEmail} maxLength={255} fullWidth autoComplete="email" />
      <Input label="Phone" type="tel" value={draft.supportPhone} onChange={event => update('supportPhone', event.target.value)}
        error={errors.supportPhone} maxLength={32} fullWidth autoComplete="tel" helperText="Digits, spaces and + ( ) . - only." />
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Currency</span>
        <span className={styles.fieldHelp} data-testid="store-currency">USD – US Dollar (fixed)</span>
      </div>
      <Input label="Address line 1" value={draft.addressLine1} onChange={event => update('addressLine1', event.target.value)}
        error={errors.addressLine1} maxLength={255} fullWidth autoComplete="address-line1" />
      <Input label="Address line 2" value={draft.addressLine2} onChange={event => update('addressLine2', event.target.value)}
        error={errors.addressLine2} maxLength={255} fullWidth autoComplete="address-line2" />
      <Input label="City" value={draft.city} onChange={event => update('city', event.target.value)} error={errors.city} maxLength={100} fullWidth
        autoComplete="address-level2" />
      <Input label="State or region" value={draft.region} onChange={event => update('region', event.target.value)} error={errors.region}
        maxLength={100} fullWidth autoComplete="address-level1" />
      <Input label="Postal code" value={draft.postalCode} onChange={event => update('postalCode', event.target.value)} error={errors.postalCode}
        maxLength={20} fullWidth autoComplete="postal-code" />
      <Input label="Country" value={draft.country} onChange={event => update('country', event.target.value)} error={errors.country} maxLength={100}
        fullWidth autoComplete="country-name" />
      <div className={styles.fieldFull}>
        <Select label="Time zone" options={timeZoneOptions} value={draft.timezone} onValueChange={value => update('timezone', value)}
          error={errors.timezone} fullWidth aria-label="Time zone" />
      </div>
    </div>
    <div className={styles.formActions}>
      <Button type="submit" isLoading={save.isPending} disabled={!dirty || save.isPending || conflict}>Save Changes</Button>
    </div>
  </form>;
}
