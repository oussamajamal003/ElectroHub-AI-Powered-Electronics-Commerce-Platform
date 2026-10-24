import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowRight, Camera, CornerDownLeft, FolderOpen, Package, Search, Tag, X } from 'lucide-react';
import type { Suggestion } from '../api';
import { useSearchSuggestions } from '../queries';
import { normalizeQuery } from '../searchState';
import { resultsHref, suggestionHref } from './links';
import { shortcutLabel, type DiscoveryMode } from './context';
import { highlight } from './highlight';
import { DiscoveryQuickActions } from './DiscoveryQuickActions';
import { DiscoveryImageMode } from './DiscoveryImageMode';
import styles from './Discovery.module.scss';

const GROUPS: { type: Suggestion['type']; label: string; meta: string; Icon: typeof Package }[] = [
  { type: 'PRODUCT', label: 'Products', meta: 'Product', Icon: Package },
  { type: 'BRAND', label: 'Brands', meta: 'Brand', Icon: Tag },
  { type: 'CATEGORY', label: 'Categories', meta: 'Category', Icon: FolderOpen },
];
interface Props { initialMode: DiscoveryMode; initialQuery: string; startCamera: boolean; onClose: () => void }

export function DiscoveryConsole({ initialMode, initialQuery, startCamera, onClose }: Props) {
  const id = useId();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<(() => boolean) | null>(null);
  // Opened programmatically (header, Ctrl/⌘ K), so there is no Radix Trigger to restore; remember what had focus instead.
  const [returnFocus] = useState(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
  const [mode, setMode] = useState<DiscoveryMode>(initialMode);
  const [query, setQuery] = useState(initialQuery);
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const [debounced, setDebounced] = useState(normalizeQuery(initialQuery));
  const [active, setActive] = useState(-1);
  const [cameraOnEnter, setCameraOnEnter] = useState(startCamera);
  const normalized = normalizeQuery(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(normalized), 175);
    return () => clearTimeout(timer);
  }, [normalized]);
  const settled = debounced === normalized;
  const suggestionQuery = useSearchSuggestions(debounced, mode === 'text' && settled);
  const typing = mode === 'text' && normalized.length >= 2;
  const suggestions = useMemo(() => {
    const data = typing && settled ? suggestionQuery.data?.data ?? [] : [];
    return GROUPS.map(group => ({ ...group, items: data.filter(item => item.type === group.type) })).filter(group => group.items.length);
  }, [typing, settled, suggestionQuery.data]);
  const flat = useMemo(() => suggestions.flatMap(group => group.items), [suggestions]);
  useEffect(() => { setActive(-1); }, [flat]);
  useEffect(() => { if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' }); });
  const loading = typing && (!settled || (suggestionQuery.isPending && suggestionQuery.fetchStatus !== 'idle'));
  const failed = typing && settled && suggestionQuery.isError;
  const go = (href: string) => { onClose(); navigate(href); };
  const submit = () => {
    const selected = flat[active];
    if (selected) go(suggestionHref(selected));
    else go(resultsHref(query));
  };
  const announce = mode !== 'text' ? '' : loading ? 'Loading suggestions' : failed ? 'Suggestions are unavailable' :
    typing ? `${flat.length} ${flat.length === 1 ? 'suggestion' : 'suggestions'}` : '';
  let index = -1;
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={styles.overlay} />
      <DialogPrimitive.Content className={styles.shell} aria-describedby={`${id}-hint`}
        onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); }}
        onEscapeKeyDown={event => { if (back.current?.()) event.preventDefault(); }}>
        <DialogPrimitive.Title className={styles.srOnly}>Search ElectroHub</DialogPrimitive.Title>
        <p id={`${id}-hint`} className={styles.srOnly}>Type to search products, brands and categories, or search with a photo. Use the arrow keys to move through suggestions.</p>
        <form role="search" className={`${styles.inputRow} ${mode === 'image' ? styles.inputRowVisual : ''}`}
          onSubmit={event => { event.preventDefault(); if (mode === 'image') setMode('text'); submit(); }}>
          <Search className={styles.leadIcon} size={20} aria-hidden="true" />
          <input ref={input} className={styles.input} type="text" role="combobox" aria-label="Search products" autoComplete="off" spellCheck={false}
            enterKeyHint="search" maxLength={120} placeholder="Search phones, laptops, accessories…"
            aria-autocomplete="list" aria-expanded={mode === 'text' && flat.length > 0} aria-controls={listId}
            aria-activedescendant={active >= 0 && flat[active] ? optionId(active) : undefined}
            value={query} onChange={event => { setQuery(event.target.value); if (mode !== 'text') setMode('text'); }}
            onKeyDown={event => {
              if (!flat.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
              event.preventDefault();
              setActive(previous => event.key === 'ArrowDown' ? (previous + 1) % flat.length : previous <= 0 ? flat.length - 1 : previous - 1);
            }} />
          {query && <button type="button" className={styles.iconAction} aria-label="Clear search"
            onClick={() => { setQuery(''); input.current?.focus(); }}><X size={16} aria-hidden="true" /></button>}
          <span className={styles.divider} aria-hidden="true" />
          <button type="button" className={`${styles.modeButton} ${mode === 'image' ? styles.modeButtonOn : ''}`} aria-pressed={mode === 'image'}
            onClick={() => { setCameraOnEnter(false); setMode(current => current === 'image' ? 'text' : 'image'); }}>
            <Camera size={16} aria-hidden="true" /><span className={styles.modeLabel}>Search by image</span>
          </button>
          <DialogPrimitive.Close className={styles.close} aria-label="Close search">
            <span className={styles.keycap} aria-hidden="true">Esc</span><X className={styles.closeIcon} size={20} aria-hidden="true" />
          </DialogPrimitive.Close>
        </form>
        <div className={styles.body}>
          <div role="status" aria-live="polite" className={styles.srOnly}>{announce}</div>
          {mode === 'image' ? <DiscoveryImageMode startCamera={cameraOnEnter} backRef={back} onNavigate={go} onSearchText={() => { setMode('text'); input.current?.focus(); }} />
            : !typing ? <DiscoveryQuickActions onNavigate={go} onImage={camera => { setCameraOnEnter(camera); setMode('image'); }} />
              : <div className={styles.suggestions}>
                {loading && !flat.length && <div className={styles.skeletonList} aria-hidden="true">{[0, 1, 2].map(row => <span key={row} className={styles.skeletonRow} />)}</div>}
                {failed && <p className={styles.inlineNote}>Suggestions are unavailable right now. Press Enter to search all products.</p>}
                {!loading && !failed && settled && !flat.length && <p className={styles.inlineNote}>No quick matches for “{normalized}”. Press Enter to search the full catalog.</p>}
                {flat.length > 0 && <ul id={listId} role="listbox" aria-label="Search suggestions" className={styles.listbox}>
                  {suggestions.map(group => <li key={group.type} role="presentation">
                    <p className={styles.sectionLabel} id={`${id}-${group.type}`} aria-hidden="true">{group.label}</p>
                    <ul role="group" aria-labelledby={`${id}-${group.type}`} className={styles.group}>
                      {group.items.map(item => {
                        index += 1;
                        const position = index;
                        return <li key={`${item.type}-${item.id}`} id={optionId(position)} role="option" aria-selected={active === position}
                          className={styles.option} onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(position)}
                          onClick={() => go(suggestionHref(item))}>
                          <span className={styles.glyph} aria-hidden="true"><group.Icon size={18} /></span>
                          <span className={styles.copy}><span className={styles.title}>{highlight(item.label, normalized)}</span><span className={styles.meta}>{group.meta}</span></span>
                          <span className={`${styles.keycap} ${styles.enterHint}`} aria-hidden="true"><CornerDownLeft size={12} /></span>
                        </li>;
                      })}
                    </ul>
                  </li>)}
                </ul>}
              </div>}
        </div>
        <footer className={styles.footer}>
          <span className={styles.hints} aria-hidden="true">
            <span className={styles.hint}><span className={styles.keycap}>↑</span><span className={styles.keycap}>↓</span>Navigate</span>
            <span className={styles.hint}><span className={styles.keycap}>↵</span>Open</span>
            <span className={styles.hint}><span className={styles.keycap}>{shortcutLabel()}</span>Toggle</span>
          </span>
          <button type="button" className={styles.viewAll} onClick={() => go(resultsHref(query))}>
            <span className={styles.viewAllText}>{normalized ? `View all results for “${normalized}”` : 'Browse all products'}</span><ArrowRight size={14} aria-hidden="true" />
          </button>
        </footer>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
