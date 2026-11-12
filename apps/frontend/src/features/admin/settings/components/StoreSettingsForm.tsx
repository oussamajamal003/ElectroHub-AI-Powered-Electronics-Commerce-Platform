import { emailValidationError } from '@/lib/emailValidation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { isStepUpCancelled, useStepUp } from '@/features/admin/security/useStepUp';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { errorMessage, fieldErrors } from '@/features/admin/shared/api';
import { useAdminToast } from '@/features/admin/shared/AdminUi';
import styles from '@/features/admin/shared/AdminPages.module.scss';
import { isVersionConflict, useUpdateStoreSettings, type StoreProfile } from '../api';
import { SettingsConflictNotice } from './SettingsConflictNotice';
import settingsStyles from './SettingsForms.module.scss';

/** Editable text state: nullable server fields are held as '' and sent as '' (the server stores '' as null). */
type Draft = Record<'storeName' | 'supportEmail' | 'supportPhone' | 'addressLine1' | 'addressLine2' | 'city' | 'region' | 'postalCode' | 'country' | 'businessHours' | 'timezone', string>;

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
  businessHours: profile.businessHours ?? '',
  timezone: profile.timezone,
});

/**
 * IANA zones the browser knows (Intl.supportedValuesOf is ES2022 and not in this project's ES2020 lib, hence the narrow typed read),
 * plus UTC and the saved zone so the current value is always selectable.
 */
const supportedZones = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf?.('timeZone') ?? [];

export function StoreSettingsForm({ profile, onDirtyChange, onSaved, onReload, onFailure }: {
  profile: StoreProfile;
  onFailure?: (error: unknown) => void;
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
  const { runWithStepUp, dialog, verifying } = useStepUp();
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
    const emailError = emailValidationError(draft.supportEmail, true);
    if (emailError) { setErrors(current => ({ ...current, supportEmail: emailError })); return; }
    try {
      await runWithStepUp(() => save.mutateAsync({ expectedVersion, ...draft }));
      toast('Store settings saved');
      onSaved();
    } catch (error) {
      onFailure?.(error);
      if (isStepUpCancelled(error)) return;
      if (isVersionConflict(error)) { setConflict(true); return; }
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) { setErrors(fields); return; }
      setFormError(errorMessage(error, 'The store settings could not be saved. Try again.'));
    }
  };

  return <><form className={styles.form} onSubmit={submit} noValidate aria-label="Store information">
    {conflict && <SettingsConflictNotice subject="settings" onReload={onReload} />}
    {formError && <p className={styles.formError} role="alert">{formError}</p>}
    <div className={styles.fieldGrid}>
      <h3 className={settingsStyles.groupHeading}>Store and contact</h3>
      <Input label="Store name" value={draft.storeName} onChange={event => update('storeName', event.target.value)} error={errors.storeName}
        maxLength={120} fullWidth autoComplete="organization" placeholder="Your store name" />
      <Input label="Store email" type="email" value={draft.supportEmail} onChange={event => update('supportEmail', event.target.value)}
        error={errors.supportEmail} maxLength={255} fullWidth autoComplete="email" placeholder="support@example.com"
        helperText="Public. Customer messages from the Contact page are delivered here." />
      <Input label="Phone" type="tel" value={draft.supportPhone} onChange={event => update('supportPhone', event.target.value)}
        error={errors.supportPhone} maxLength={32} fullWidth autoComplete="tel" placeholder="+961 XX XXX XXX"
        helperText="Public. Digits, spaces and + ( ) . - only." />
      <Input label="Business hours" value={draft.businessHours} onChange={event => update('businessHours', event.target.value)}
        error={errors.businessHours} maxLength={255} fullWidth placeholder="Monday–Friday, 9:00 AM–6:00 PM"
        helperText="Public. Leave a field empty to hide it from the Contact page." />
      <Input label="Currency" value="USD – US Dollar (fixed)" readOnly fullWidth data-testid="store-currency" />
      <h3 className={settingsStyles.groupHeading}>Address and locale</h3>
      <Input label="Address line 1" value={draft.addressLine1} onChange={event => update('addressLine1', event.target.value)}
        error={errors.addressLine1} maxLength={255} fullWidth autoComplete="address-line1" placeholder="Street, Building" />
      <Input label="Address line 2" value={draft.addressLine2} onChange={event => update('addressLine2', event.target.value)}
        error={errors.addressLine2} maxLength={255} fullWidth autoComplete="address-line2" placeholder="Floor, suite (optional)" />
      <Input label="City" value={draft.city} onChange={event => update('city', event.target.value)} error={errors.city} maxLength={100} fullWidth
        autoComplete="address-level2" placeholder="Enter city" />
      <Input label="State or region" value={draft.region} onChange={event => update('region', event.target.value)} error={errors.region}
        maxLength={100} fullWidth autoComplete="address-level1" placeholder="Enter state or region (optional)" />
      <Input label="Postal code" value={draft.postalCode} onChange={event => update('postalCode', event.target.value)} error={errors.postalCode}
        maxLength={20} fullWidth autoComplete="postal-code" placeholder="Enter postal code (optional)" />
      <Input label="Country" value={draft.country} onChange={event => update('country', event.target.value)} error={errors.country} maxLength={100}
        fullWidth autoComplete="country-name" placeholder="Enter country" />
      <div className={styles.fieldFull}>
        <Select label="Time zone" options={timeZoneOptions} value={draft.timezone} onValueChange={value => update('timezone', value)}
          error={errors.timezone} fullWidth aria-label="Time zone" />
      </div>
    </div>
    <div className={`${styles.formActions} ${settingsStyles.formActions}`}>
      <Button type="submit" isLoading={save.isPending} disabled={!dirty || save.isPending || verifying || conflict}>Save Changes</Button>
    </div>
  </form>{dialog}</>;
}
