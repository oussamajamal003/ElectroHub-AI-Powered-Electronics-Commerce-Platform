import type { ReactNode } from 'react';
import styles from './FilterControls.module.scss';
import { Select } from '@/components/ui/Select';
interface Choice { value: string; label: string }
export function FilterChipGroup({ label, value, choices, onChange }: { label: string; value: string; choices: Choice[]; onChange: (value: string) => void }) {
  return <div role="group" aria-label={label} className={styles.chips}>{choices.map(choice =>
    <button key={choice.value} type="button" aria-pressed={value === choice.value} onClick={() => onChange(choice.value)}>{choice.label}</button>)}</div>;
}
interface FilterSelectProps { label: string; value: string; choices: Choice[]; onChange: (value: string) => void; selectSize?: 'small' | 'medium' | 'large';
  /** Toolbar form: the label becomes the accessible name only, and the trigger shows icon + selected option. */
  compact?: { icon: ReactNode; triggerClassName: string; contentClassName: string } }
export function FilterSelect({ label, value, choices, onChange, selectSize = 'medium', compact }: FilterSelectProps) {
  return <div className={styles.select}>{compact
    ? <Select aria-label={label} value={value} onValueChange={onChange} options={choices} fullWidth square leadingIcon={compact.icon}
        triggerClassName={compact.triggerClassName} contentClassName={compact.contentClassName} />
    : <Select label={label} value={value} onValueChange={onChange} options={choices} selectSize={selectSize} fullWidth square placeholder={choices.find(choice => choice.value === '')?.label} />}</div>;
}
