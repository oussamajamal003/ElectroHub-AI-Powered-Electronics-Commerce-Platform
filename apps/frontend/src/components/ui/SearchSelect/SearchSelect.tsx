import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, Search } from 'lucide-react';
import styles from './SearchSelect.module.scss';

export interface SearchSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Short muted text after the label (for example a product count). */
  hint?: string;
  /** Consecutive options with the same group are listed under one heading, in the order given. */
  group?: string;
}

export interface SearchSelectProps {
  /** Accessible name; shown above the trigger unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  error?: string;
  helperText?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  className?: string;
  triggerClassName?: string;
}

/**
 * A select for long lists (categories, brands): a button that opens a search field over a listbox (WAI-ARIA combobox pattern with
 * aria-activedescendant). Arrow keys, Home/End, Enter, Escape and type-to-search work; the selected option scrolls into view; the
 * popup is never narrower than the trigger nor wider than the viewport, opens upward when there is no room below, and long labels
 * wrap within the available width so their full text remains visible.
 */
export function SearchSelect({ label, hideLabel, value, onValueChange, options, placeholder = 'Select…', searchPlaceholder = 'Search',
  emptyText = 'No matches', error, helperText, required, disabled, fullWidth, className, triggerClassName }: SearchSelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState<{ up: boolean; right: boolean; maxWidth?: number }>({ up: false, right: false });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const selected = options.find(option => option.value === value);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter(option => option.label.toLowerCase().includes(needle)) : options;
  }, [options, query]);
  const enabled = (index: number) => index >= 0 && index < visible.length && !visible[index]!.disabled;

  const show = (initialQuery = '') => {
    if (disabled) return;
    setQuery(initialQuery);
    setOpen(true);
  };
  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  };
  const choose = (option: SearchSelectOption | undefined) => {
    if (!option || option.disabled) return;
    onValueChange(option.value);
    close();
  };

  // On open (and whenever the matches change) highlight the selected option, else the first enabled one.
  useEffect(() => {
    if (!open) return;
    const current = visible.findIndex(option => option.value === value);
    setActive(current >= 0 && !query ? current : visible.findIndex(option => !option.disabled));
  }, [open, visible, value, query]);

  useLayoutEffect(() => {
    if (!open || !panel.current || !trigger.current) return;
    input.current?.focus();
    const box = trigger.current.getBoundingClientRect();
    const height = panel.current.offsetHeight;
    const width = panel.current.offsetWidth;
    const below = window.innerHeight - box.bottom;
    // Open toward the side with room, and never wider than that room (16px page gutter), so the popup stays inside the viewport.
    const roomRight = window.innerWidth - box.left - 16;
    const roomLeft = box.right - 16;
    const right = width > roomRight && roomLeft > roomRight;
    setPlacement({ up: below < height + 8 && box.top > below, right, maxWidth: Math.max(box.width, right ? roomLeft : roomRight) });
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const move = (from: number, step: 1 | -1) => {
    for (let index = from + step; index >= 0 && index < visible.length; index += step) if (enabled(index)) return index;
    return from;
  };
  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); show(event.key); }
  };
  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(current => current < 0 ? move(-1, 1) : move(current, 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(current => move(current, -1)); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(move(-1, 1)); }
    else if (event.key === 'End') { event.preventDefault(); setActive(move(visible.length, -1)); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(visible[active]); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') close(false);
  };

  const listId = `${id}-list`;
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const optionId = (index: number) => `${id}-option-${index}`;

  // Group consecutive options under their heading while keeping one flat index for keyboard navigation.
  const groups: { name?: string; items: { option: SearchSelectOption; index: number }[] }[] = [];
  visible.forEach((option, index) => {
    const last = groups.at(-1);
    if (last && last.name === option.group) last.items.push({ option, index });
    else groups.push({ name: option.group, items: [{ option, index }] });
  });

  return <div ref={root} className={clsx(styles.container, fullWidth && styles.fullWidth, className)}>
    <span id={labelId} className={clsx(styles.label, hideLabel && styles.visuallyHidden, disabled && styles.labelDisabled)}>
      {label}{required && <span className={styles.required} aria-hidden="true">*</span>}
    </span>
    <button ref={trigger} type="button" className={clsx(styles.trigger, error && styles.error, triggerClassName)} disabled={disabled}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-labelledby={`${labelId} ${id}-value`}
      aria-invalid={error ? true : undefined} aria-required={required || undefined}
      aria-describedby={(error ? errorId : helperText ? helpId : undefined)}
      onClick={() => (open ? close() : show())} onKeyDown={onTriggerKey}>
      <span id={`${id}-value`} className={clsx(styles.value, !selected && styles.placeholder)} title={selected?.label}>{selected?.label ?? placeholder}</span>
      <ChevronDown className={clsx(styles.icon, open && styles.iconOpen)} aria-hidden="true" />
    </button>
    {open && <div ref={panel} className={clsx(styles.panel, placement.up && styles.up, placement.right && styles.right)}
      style={placement.maxWidth ? { maxWidth: Math.min(placement.maxWidth, 448) } : undefined}>
      <div className={styles.searchRow}>
        <Search className={styles.searchIcon} aria-hidden="true" />
        <input ref={input} type="text" className={styles.search} value={query} placeholder={searchPlaceholder} role="combobox"
          aria-label={`Search ${label.toLowerCase()}`} aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined} autoComplete="off" spellCheck={false}
          onChange={event => setQuery(event.target.value)} onKeyDown={onInputKey} />
      </div>
      <div ref={list} id={listId} role="listbox" aria-label={label} className={styles.list}>
        {visible.length === 0 && <div className={styles.empty} role="presentation">{emptyText}</div>}
        {groups.map((group, groupIndex) => {
          const items = group.items.map(({ option, index }) => <div key={option.value} id={optionId(index)} data-index={index} role="option"
            aria-selected={option.value === value} aria-disabled={option.disabled || undefined} title={option.label}
            className={clsx(styles.option, index === active && styles.optionActive, option.value === value && styles.optionSelected,
              option.disabled && styles.optionDisabled)}
            onPointerDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled && index !== active) setActive(index); }}
            onClick={() => choose(option)}>
            <Check className={styles.check} aria-hidden="true" />
            <span className={styles.optionLabel}>{option.label}</span>
            {option.hint && <span className={styles.hint}>{option.hint}</span>}
          </div>);
          if (!group.name) return <div key={`group-${groupIndex}`} role="presentation">{items}</div>;
          const headingId = `${id}-group-${groupIndex}`;
          return <div key={`group-${groupIndex}`} role="group" aria-labelledby={headingId}>
            <div id={headingId} role="presentation" className={styles.groupLabel}>{group.name}</div>
            {items}
          </div>;
        })}
      </div>
    </div>}
    {helperText && !error && <span id={helpId} className={styles.helper}>{helperText}</span>}
    {error && <span id={errorId} className={styles.errorMessage}>{error}</span>}
  </div>;
}
