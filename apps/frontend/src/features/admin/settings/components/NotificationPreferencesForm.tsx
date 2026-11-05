import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { errorMessage, fieldErrors } from '@/features/admin/shared/api';
import { useAdminToast } from '@/features/admin/shared/AdminUi';
import styles from '@/features/admin/shared/AdminPages.module.scss';
import { isVersionConflict, useUpdateNotificationPreferences, type NotificationPreferences } from '../api';
import { SettingsConflictNotice } from './SettingsConflictNotice';
import settingsStyles from './SettingsForms.module.scss';

type Toggle = 'orderPaid' | 'lowStock';

/**
 * Only the alerts the server actually sends are offered: a paid order and a product that falls to low or out of stock. Each is
 * an operational email for verified administrators; the preference applies to the signed-in administrator only.
 */
const TOGGLES: { key: Toggle; label: string; hint: string }[] = [
  { key: 'orderPaid', label: 'New order received', hint: 'Sent when a customer payment is confirmed.' },
  { key: 'lowStock', label: 'Low stock alert', hint: 'Sent when a product drops to low or out of stock.' },
];

export function NotificationPreferencesForm({ preferences, onDirtyChange, onSaved, onReload }: {
  preferences: NotificationPreferences;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onReload: () => Promise<void>;
}) {
  const [baseline] = useState(preferences);
  const [draft, setDraft] = useState<Toggle[]>(() => TOGGLES.filter(toggle => baseline[toggle.key]).map(toggle => toggle.key));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const save = useUpdateNotificationPreferences();
  const toast = useAdminToast();
  const dirty = TOGGLES.some(toggle => draft.includes(toggle.key) !== baseline[toggle.key]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const setOn = (key: Toggle, on: boolean) => setDraft(current => on ? [...current, key] : current.filter(item => item !== key));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setConflict(false);
    try {
      await save.mutateAsync({
        expectedVersion: baseline.version,
        orderPaid: draft.includes('orderPaid'),
        lowStock: draft.includes('lowStock'),
        // Not offered on this screen; sent back unchanged so the update never resets it.
        invitationAccepted: baseline.invitationAccepted,
      });
      toast('Notification preferences saved');
      onSaved();
    } catch (error) {
      if (isVersionConflict(error)) { setConflict(true); return; }
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) { setErrors(fields); return; }
      setFormError(errorMessage(error, 'Your preferences could not be saved. Try again.'));
    }
  };

  return <form className={styles.form} onSubmit={submit} noValidate aria-label="Notification preferences">
    {conflict && <SettingsConflictNotice subject="preferences" onReload={onReload} />}
    {formError && <p className={styles.formError} role="alert">{formError}</p>}
    <fieldset className={settingsStyles.group}>
      <legend className={styles.fieldLabel}>Email notifications</legend>
      <p className={styles.fieldHelp}>Sent to verified administrator accounts. Changes apply to your account only.</p>
      {TOGGLES.map(toggle => <label key={toggle.key} className={settingsStyles.option}>
        <Checkbox checked={draft.includes(toggle.key)} onCheckedChange={checked => setOn(toggle.key, checked === true)} />
        <span className={settingsStyles.optionText}>
          <span>{toggle.label}</span>
          <span className={styles.fieldHelp}>{toggle.hint}</span>
        </span>
      </label>)}
      {errors.orderPaid && <p className={styles.fieldError}>{errors.orderPaid}</p>}
      {errors.lowStock && <p className={styles.fieldError}>{errors.lowStock}</p>}
    </fieldset>
    <div className={styles.formActions}>
      <Button type="submit" isLoading={save.isPending} disabled={!dirty || save.isPending || conflict}>Save Preferences</Button>
    </div>
  </form>;
}
