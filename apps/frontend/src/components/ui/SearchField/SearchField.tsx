import { useEffect, useId, useRef, useState } from 'react';
import { Search, X, Package, Tag, FolderOpen } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import type { Suggestion } from '@/features/search/api';
import { useSearchSuggestions } from '@/features/search/queries';
import { normalizeQuery } from '@/features/search/searchState';
import styles from './SearchField.module.scss';

interface Props {
  value: string; onChange: (value: string) => void; onSelect: (suggestion: Suggestion) => void;
}
export function SearchField({ value, onChange, onSelect }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const normalizedValue = normalizeQuery(value);
  const suggestionQuery = useSearchSuggestions(debouncedQuery, focused && debouncedQuery === normalizedValue);
  const suggestions = debouncedQuery === normalizedValue && focused ? suggestionQuery.data?.data ?? [] : [];
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(normalizedValue), 175);
    return () => clearTimeout(timer);
  }, [normalizedValue]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setFocused(false); } };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const expanded = open && suggestions.length > 0;
  const select = (suggestion: Suggestion) => { setOpen(false); setFocused(false); onSelect(suggestion); };
  return <div className={styles.root} ref={root}>
    <Search className={styles.icon} size={22} aria-hidden="true" />
    <Input ref={input} id={`${id}-input`} role="combobox" aria-label="Search products" autoComplete="off"
      aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-list`}
      aria-activedescendant={expanded && active >= 0 ? `${id}-${active}` : undefined}
      value={value} maxLength={120} inputSize="medium" fullWidth
      placeholder="Search for MacBook, iPhone, headphones..."
      onChange={event => { onChange(event.target.value); setActive(-1); setFocused(true); setOpen(true); }}
      onFocus={() => { setFocused(true); setOpen(true); }} onBlur={() => { setFocused(false); setOpen(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); setActive(-1); }
        if (expanded && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault(); setActive(previous => event.key === 'ArrowDown' ? (previous + 1) % suggestions.length : (previous <= 0 ? suggestions.length - 1 : previous - 1));
        }
        if (event.key === 'Enter') {
          const selected = suggestions[active];
          if (expanded && active >= 0 && selected) { event.preventDefault(); select(selected); }
          else { setOpen(false); setFocused(false); }
        }
      }}
      endAdornment={value ? <button type="button" aria-label="Clear search input" className={styles.clear}
        onClick={() => { onChange(''); input.current?.focus(); }}><X size={18} /></button> : null} />
    {expanded && <ul id={`${id}-list`} role="listbox" aria-label="Search suggestions" className={styles.list}>
      {suggestions.map((suggestion, index) => <li role="option" id={`${id}-${index}`} key={`${suggestion.type}-${suggestion.id}`}
        aria-selected={active === index} className={active === index ? styles.active : undefined}
        onPointerDown={event => event.preventDefault()} onClick={() => select(suggestion)}>
        {suggestion.type === 'PRODUCT' ? <Package className={styles.suggestionIcon} size={20} aria-hidden="true" /> : suggestion.type === 'BRAND' ? <Tag className={styles.suggestionIcon} size={20} aria-hidden="true" /> : <FolderOpen className={styles.suggestionIcon} size={20} aria-hidden="true" />}
        <span className={styles.suggestionCopy}><span className={styles.suggestionTitle}>{suggestion.label}</span><small>{suggestion.type === 'PRODUCT' ? 'Product' : suggestion.type === 'BRAND' ? 'Brand' : 'Category'}</small></span>
      </li>)}
    </ul>}
  </div>;
}
