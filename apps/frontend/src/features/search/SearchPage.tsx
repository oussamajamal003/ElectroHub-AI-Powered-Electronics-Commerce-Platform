import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { ProductCard, ProductCardSkeleton } from '@/components/ui/ProductCard';
import { StaggerItem } from '@/components/motion/Motion';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/Pagination';
import { SearchField } from '@/components/ui/SearchField/SearchField';
import { FilterChipGroup, FilterSelect } from '@/components/ui/FilterControls/FilterControls';
import { activeSearch, clearFilters, emptySearch, normalizeQuery, parseSearch, searchParams, type SearchState } from './searchState';
import { productCardProps, type Suggestion } from './api';
import { useBrands, useCategories, useSearchResults } from './queries';
import { ImageSearchShell } from './ImageSearchShell';
import styles from './SearchPage.module.scss';

export function SearchPage({ catalog = false }: { catalog?: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const serialized = params.toString();
  const parsed = useMemo(() => {
    try {
      const urlState = new URLSearchParams(serialized);
      if (!catalog) for (const key of ['category', 'brand', 'availability', 'minPrice', 'maxPrice']) urlState.delete(key);
      return { state: parseSearch(urlState), error: '' };
    }
    catch { return { state: emptySearch, error: 'The search link contains invalid values. Clear the search to start again.' }; }
  }, [serialized, catalog]);
  const state = parsed.state;
  const active = !parsed.error && (catalog || activeSearch(state));
  const [draft, setDraft] = useState(state.q);
  const normalizedDraft = normalizeQuery(draft);
  const [tab, setTab] = useState('text');
  const [showFilters, setShowFilters] = useState(false);
  const [filterDraft, setFilterDraft] = useState<Pick<SearchState, 'category' | 'brand' | 'availability' | 'minPrice' | 'maxPrice'>>({});
  const filterButton = useRef<HTMLButtonElement>(null);
  const filterPanel = useRef<HTMLElement>(null);
  const categoriesQuery = useCategories(!catalog || showFilters || Boolean(state.category));
  const brandsQuery = useBrands(!catalog || showFilters || Boolean(state.brand));
  const searchQuery = useSearchResults(state, active && tab === 'text');
  const categories = categoriesQuery.data ?? [];
  const brands = brandsQuery.data ?? [];
  const results = active && tab === 'text' ? searchQuery.data : undefined;
  const loading = active && tab === 'text' && searchQuery.isPending;
  const error = searchQuery.isError && active && tab === 'text';
  const metadataError = categoriesQuery.isError || brandsQuery.isError;
  const [formError, setFormError] = useState('');
  useEffect(() => { setDraft(state.q); setFormError(''); }, [state]);
  const commit = useCallback((next: SearchState, replace = false) => {
    try {
      const validated = parseSearch(searchParams(next));
      setFormError(''); setParams(searchParams(validated), { replace }); return true;
    } catch (failure) { setFormError(failure instanceof Error ? failure.message : 'Check your search values.'); return false; }
  }, [setParams]);
  useEffect(() => {
    if (parsed.error || tab !== 'text' || normalizedDraft === state.q) return;
    const timer = setTimeout(() => commit({ ...state, q: normalizedDraft, page: 1 }, true), 275);
    return () => clearTimeout(timer);
  }, [normalizedDraft, state, parsed.error, tab, commit]);
  const update = (patch: Partial<SearchState>) => commit({ ...state, q: normalizedDraft, ...patch, page: 1 });
  const selectSuggestion = (suggestion: Suggestion) => {
    if (suggestion.type === 'PRODUCT') { setDraft(suggestion.label); update({ q: suggestion.label }); }
    else commit({ ...state, [suggestion.type === 'BRAND' ? 'brand' : 'category']: suggestion.slug, page: 1 });
  };
  const filterChoices = (data: { name: string; slug: string }[], current?: string) => {
    const choices = data.map(value => ({ value: value.slug, label: value.name }));
    if (current && !data.some(value => value.slug === current)) choices.push({ value: current, label: current });
    return choices;
  };
  const filterCount = Number(Boolean(state.category)) + Number(Boolean(state.brand)) + Number(Boolean(state.availability)) +
    Number(state.minPrice !== undefined || state.maxPrice !== undefined);
  const openFilters = () => {
    if (showFilters) { setShowFilters(false); return; }
    setFilterDraft({ category: state.category, brand: state.brand, availability: state.availability,
      minPrice: state.minPrice, maxPrice: state.maxPrice });
    setShowFilters(true);
    requestAnimationFrame(() => filterPanel.current?.focus());
  };
  const removeFilter = (patch: Partial<SearchState>) => update(patch);
  const priceLabel = (value: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value));
  const priceText = state.minPrice && state.maxPrice ? `${priceLabel(state.minPrice)}–${priceLabel(state.maxPrice)}` :
    state.minPrice ? `${priceLabel(state.minPrice)}+` : state.maxPrice ? `Up to ${priceLabel(state.maxPrice)}` : '';
  const totalPages = Math.min(results?.meta.totalPages ?? 0, 1000);
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) =>
    Math.max(1, Math.min(state.page - 2, totalPages - 4)) + index);
  return <>
    <div className={styles.container}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link to="/">Home</Link><ChevronRight size={16} aria-hidden="true" /><span aria-current="page">{catalog ? 'All Products' : 'Search'}</span></nav>
      <div className={styles.titleRow}>
        <h1 className={styles.pageTitle}>{catalog ? 'All Products' : 'Search'}</h1>
        {catalog && results && (
          <span className={styles.resultCount}>{results.meta.total} products</span>
        )}
      </div>
      {!catalog && <p className={styles.subtitle}>Find laptops, phones, audio, and more.</p>}
      <Tabs value={tab} onValueChange={setTab}>
        {!catalog && <TabsList className={styles.tabs} aria-label="Search method"><TabsTrigger value="text">Text Search</TabsTrigger><TabsTrigger value="image">Image Search</TabsTrigger></TabsList>}
        <TabsContent value="text">
          <div className={catalog ? styles.catalogToolbar : styles.searchToolbar}>
            <form role="search" className={styles.searchForm + (catalog ? ' ' + styles.catalogSearch : '')} onSubmit={event => { event.preventDefault(); if (normalizedDraft !== state.q) commit({ ...state, q: normalizedDraft, page: 1 }, true); }}>
              <SearchField value={draft} onChange={setDraft} onSelect={selectSuggestion} />
            </form>
            {catalog && <Button ref={filterButton} type="button" variant="outline" aria-expanded={showFilters} aria-controls="search-filters" onClick={openFilters}><SlidersHorizontal size={18} /> Filters{filterCount ? ` (${filterCount})` : ''}</Button>}
            <FilterSelect label="Sort by" value={state.sort ?? (state.q ? 'relevance' : 'newest')} selectSize={catalog ? 'medium' : 'large'} choices={[
              { value: 'relevance', label: 'Relevance' }, { value: 'price-asc', label: 'Price: low to high' }, { value: 'price-desc', label: 'Price: high to low' }, { value: 'newest', label: 'Newest' }, { value: 'name-asc', label: 'Name: A–Z' },
            ]} onChange={value => update({ sort: value as SearchState['sort'] })} />
          </div>
          {(parsed.error || formError) && <div role="alert" className={styles.error}>{parsed.error || formError}
            {parsed.error && <Button type="button" variant="link" onClick={() => setParams({})}>Clear search</Button>}</div>}
          {catalog && showFilters && <section ref={filterPanel} tabIndex={-1} id="search-filters" aria-label="Product filters" className={styles.toolbar}
            onKeyDown={event => { if (event.key === 'Escape') { setShowFilters(false); filterButton.current?.focus(); } }}>
            {(categoriesQuery.isPending || brandsQuery.isPending) && <p role="status">Loading filters…</p>}
            {metadataError && <p role="status">Filters are temporarily unavailable. You can still search by text. <Button type="button" variant="link" onClick={() => { void categoriesQuery.refetch(); void brandsQuery.refetch(); }}>Retry filters</Button></p>}
            <FilterChipGroup label="Category" value={filterDraft.category ?? ''} choices={[{ value: '', label: 'All' }, ...filterChoices(categories, filterDraft.category)]} onChange={value => setFilterDraft(previous => ({ ...previous, category: value || undefined }))} />
            <div className={styles.filterRow}>
              <FilterSelect label="Brand" value={filterDraft.brand ?? ''} choices={[{ value: '', label: 'All brands' }, ...filterChoices(brands, filterDraft.brand)]} onChange={value => setFilterDraft(previous => ({ ...previous, brand: value || undefined }))} />
              <FilterSelect label="Availability" value={filterDraft.availability ?? ''} choices={[{ value: '', label: 'Any availability' }, { value: 'available', label: 'Available' }, { value: 'unavailable', label: 'Unavailable' }]} onChange={value => setFilterDraft(previous => ({ ...previous, availability: value === 'available' || value === 'unavailable' ? value : undefined }))} />
              <Input label="Min price ($)" inputMode="decimal" value={filterDraft.minPrice ?? ''} onChange={event => setFilterDraft(previous => ({ ...previous, minPrice: event.target.value || undefined }))} />
              <Input label="Max price ($)" inputMode="decimal" value={filterDraft.maxPrice ?? ''} onChange={event => setFilterDraft(previous => ({ ...previous, maxPrice: event.target.value || undefined }))} />
            </div>
            <div className={styles.filterActions}>
              <Button type="button" variant="secondary" onClick={() => { if (commit(clearFilters({ ...state, q: normalizedDraft }))) { setFilterDraft({}); setShowFilters(false); filterButton.current?.focus(); } }}>Reset</Button>
              <Button type="button" onClick={() => { if (commit({ ...state, q: normalizedDraft, ...filterDraft, page: 1 })) { setShowFilters(false); filterButton.current?.focus(); } }}>Apply filters</Button>
            </div>
          </section>}
          {catalog && filterCount > 0 && <div className={styles.activeFilters} aria-label="Active filters">
            {state.category && <button type="button" onClick={() => removeFilter({ category: undefined })} aria-label={`Remove category filter ${categories.find(value => value.slug === state.category)?.name ?? state.category}`}>{categories.find(value => value.slug === state.category)?.name ?? state.category} ×</button>}
            {state.brand && <button type="button" onClick={() => removeFilter({ brand: undefined })} aria-label={`Remove brand filter ${brands.find(value => value.slug === state.brand)?.name ?? state.brand}`}>{brands.find(value => value.slug === state.brand)?.name ?? state.brand} ×</button>}
            {state.availability && <button type="button" onClick={() => removeFilter({ availability: undefined })} aria-label={`Remove availability filter ${state.availability}`}>{state.availability === 'available' ? 'Available' : 'Unavailable'} ×</button>}
            {priceText && <button type="button" onClick={() => removeFilter({ minPrice: undefined, maxPrice: undefined })} aria-label={`Remove price filter ${priceText}`}>{priceText} ×</button>}
          </div>}
          <section aria-label="Search results" aria-busy={loading} className={styles.results}>
            <div role="status" aria-live="polite">{loading ? 'Searching products…' : results ? `${results.meta.total} ${results.meta.total === 1 ? 'result' : 'results'}${state.q ? ` for “${state.q}”` : ''}` : ''}</div>
            {loading && <div className={`${styles.grid} ${catalog ? styles.catalogGrid : ''}`} aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <ProductCardSkeleton key={index} />)}</div>}
            {error && <div role="alert" className={styles.empty}><h2>Search unavailable</h2><p>Search is temporarily unavailable. Please try again.</p><Button type="button" onClick={() => void searchQuery.refetch()}>Retry search</Button></div>}
            {results && results.data.length > 0 && <div className={`${styles.grid} ${catalog ? styles.catalogGrid : ''}`}>{results.data.map((product, index) => catalog
              ? <StaggerItem key={product.id} replay index={index % 4}><ProductCard {...productCardProps(product)} onNavigate={navigate} /></StaggerItem>
              : <ProductCard key={product.id} {...productCardProps(product)} onNavigate={navigate} />)}</div>}
            {results && results.data.length === 0 && <div className={styles.empty}><h2>{state.q ? `No results for “${state.q}”` : 'No products found'}</h2><p>Try adjusting your search or filters.</p>{catalog && filterCount > 0 && <Button type="button" variant="link" onClick={() => commit(clearFilters({ ...state, q: normalizedDraft }))}>Reset filters</Button>}{state.q && <Button type="button" variant="link" onClick={() => { setDraft(''); update({ q: '' }); }}>Clear query</Button>}{state.page > 1 && <Button type="button" variant="link" onClick={() => commit({ ...state, page: 1 })}>First page</Button>}</div>}
            {totalPages > 1 && <Pagination aria-label="Search result pages"><PaginationContent>
              <PaginationItem><PaginationPrevious disabled={state.page <= 1} onClick={() => commit({ ...state, page: state.page - 1 })} /></PaginationItem>
              {pages.map(page => <PaginationItem key={page}><PaginationLink aria-label={`Go to page ${page}`} isActive={page === state.page} onClick={() => commit({ ...state, page })}>{page}</PaginationLink></PaginationItem>)}
              <PaginationItem><PaginationNext disabled={state.page >= totalPages} onClick={() => commit({ ...state, page: state.page + 1 })} /></PaginationItem>
            </PaginationContent></Pagination>}
          </section>
        </TabsContent>
        {!catalog && <TabsContent value="image"><ImageSearchShell /></TabsContent>}
      </Tabs>
    </div>
  </>;
}
