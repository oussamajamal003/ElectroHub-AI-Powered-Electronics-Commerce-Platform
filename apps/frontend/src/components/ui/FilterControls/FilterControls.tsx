import styles from './FilterControls.module.scss';
import { Select } from '@/components/ui/Select';
interface Choice { value: string; label: string }
export function FilterChipGroup({ label, value, choices, onChange }: { label: string; value: string; choices: Choice[]; onChange: (value: string) => void }) {
  return <div role="group" aria-label={label} className={styles.chips}>{choices.map(choice =>
    <button key={choice.value} type="button" aria-pressed={value === choice.value} onClick={() => onChange(choice.value)}>{choice.label}</button>)}</div>;
}
export function FilterSelect({ label, value, choices, onChange, selectSize = 'medium' }: { label: string; value: string; choices: Choice[]; onChange: (value: string) => void; selectSize?: 'small' | 'medium' | 'large' }) {
  return <div className={styles.select}><Select label={label} value={value} onValueChange={onChange} options={choices} selectSize={selectSize} fullWidth square /></div>;
}
