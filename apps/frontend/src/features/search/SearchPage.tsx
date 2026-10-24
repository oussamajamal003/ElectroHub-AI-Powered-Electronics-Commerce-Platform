import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpDown, ChevronDown, ChevronRight, SearchX, SlidersHorizontal } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { ProductCard, ProductCardSkeleton } from '@/components/ui/ProductCard';
import { StaggerItem } from '@/components/motion/Motion';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/Pagination';
import { SearchField } from '@/components/ui/SearchField/SearchField';
import { FilterSelect } from '@/components/ui/FilterControls/FilterControls';
import { activeSearch, clearFilters, emptySearch, normalizeQuery, parseSearch, searchParams, type SearchState } from './searchState';
import { productCardProps, type Suggestion } from './api';
import { useCart } from '@/features/cart/context';
import { useWishlist } from '@/features/wishlist/context';
import { useBrands, useCategories, useSearchResults } from './queries';
import { getProductGridSkeletonCount } from './skeletonCount';
import { ImageSearchShell } from './ImageSearchShell';
import styles from './SearchPage.module.scss';

export function SearchPage({ catalog = false }: { catalog?: boolean }) {
  const { addItem } = useCart();
  const wishlist = useWishlist();
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
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const normalizedDraft = normalizeQuery(draft);
  const [tab, setTab] = useState('text');
  const [showFilters, setShowFilters] = useState(false);
  // Filters apply as soon as they change; only the free-text price range keeps a short-lived draft so typing is debounced.
  const [priceDraft, setPriceDraft] = useState<Pick<SearchState, 'minPrice' | 'maxPrice'>>({ minPrice: state.minPrice, maxPrice: state.maxPrice });
  const priceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const filterPanel = useRef<HTMLElement>(null);
  const categoriesQuery = useCategories(!catalog || showFilters || Boolean(state.category));
  const brandsQuery = useBrands(!catalog || showFilters || Boolean(state.brand));
  // The catalog's default view rotates through categories so every category is represented on page one; the default
  // is not written to the URL, and typed queries keep relevance ordering.
  const defaultSort: NonNullable<SearchState['sort']> = state.q ? 'relevance' : catalog ? 'category-mix' : 'newest';
  const requestState = useMemo(() => catalog && !state.q && !state.sort ? { ...state, sort: 'category-mix' as const } : state, [catalog, state]);
  const searchQuery = useSearchResults(requestState, active && tab === 'text');
  const categories = categoriesQuery.data ?? [];
  const brands = brandsQuery.data ?? [];
  const results = active && tab === 'text' ? searchQuery.data : undefined;
  const loading = active && tab === 'text' && searchQuery.isPending;
  const error = searchQuery.isError && active && tab === 'text';
  const metadataError = categoriesQuery.isError || brandsQuery.isError;
  const [formError, setFormError] = useState('');
  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    setDraft(state.q);
    setFormError('');
  }, [serialized, state.q]);
  useEffect(() => { setPriceDraft({ minPrice: state.minPrice, maxPrice: state.maxPrice }); }, [state.minPrice, state.maxPrice]);
  useEffect(() => () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (priceTimer.current) clearTimeout(priceTimer.current);
  }, []);
  // Filters apply immediately, so several changes can land before the URL re-renders; later changes build on the
  // most recent commit instead of the render-time state so they never drop an earlier filter.
  const pending = useRef<SearchState | null>(null);
  useEffect(() => { pending.current = null; }, [serialized]);
  // smoothTop: page-number navigation glides to the top of the results instead of jumping (see CustomerScrollRestoration).
  const commit = useCallback((next: SearchState, replace = false, smoothTop = false) => {
    try {
      const validated = parseSearch(searchParams(next));
      pending.current = validated;
      setFormError(''); setParams(searchParams(validated), { replace, state: smoothTop ? { smoothTop: true } : undefined }); return true;
    } catch (failure) { setFormError(failure instanceof Error ? failure.message : 'Check your search values.'); return false; }
  }, [setParams]);
  const changeDraft = (value: string) => {
    setDraft(value);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const query = normalizeQuery(value);
    if (parsed.error || tab !== 'text' || query === state.q) { draftTimer.current = null; return; }
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      commit({ ...state, q: query, page: 1 }, true);
    }, 275);
  };
  const update = (patch: Partial<SearchState>) => commit({ ...(pending.current ?? state), q: normalizedDraft, ...patch, page: 1 });
  const selectSuggestion = (suggestion: Suggestion) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    if (suggestion.type === 'PRODUCT') { setDraft(suggestion.label); commit({ ...state, q: normalizeQuery(suggestion.label), page: 1 }); }
    else commit({ ...state, [suggestion.type === 'BRAND' ? 'brand' : 'category']: suggestion.slug, page: 1 });
  };
  const filterChoices = (data: { name: string; slug: string; productCount?: number }[], current?: string) => {
    const choices = data.map(value => ({ value: value.slug, label: value.productCount === undefined ? value.name : `${value.name} (${value.productCount})` }));
    if (current && !data.some(value => value.slug === current)) choices.push({ value: current, label: current });
    return choices;
  };
  // A category deep link titles the page with the backend's category name once Categories load.
  const activeCategory = catalog && state.category ? categories.find(value => value.slug === state.category) : undefined;
  const pageTitle = catalog ? activeCategory?.name ?? 'All Products' : 'Search';
  const allProductsLink = useMemo(() => {
    const next = new URLSearchParams(serialized);
    next.delete('category'); next.delete('page');
    const query = next.toString();
    return query ? `/products?${query}` : '/products';
  }, [serialized]);
  const filterCount = Number(Boolean(state.category)) + Number(Boolean(state.brand)) + Number(Boolean(state.availability)) +
    Number(state.minPrice !== undefined || state.maxPrice !== undefined);
  const changePrice = (patch: Partial<Pick<SearchState, 'minPrice' | 'maxPrice'>>) => {
    const next = { ...priceDraft, ...patch };
    setPriceDraft(next);
    if (priceTimer.current) clearTimeout(priceTimer.current);
    priceTimer.current = setTimeout(() => { priceTimer.current = null; update(next); }, 500);
  };
  const priceInvalid = Boolean(formError) && /price/i.test(formError);
  const clearAllFilters = () => {
    if (priceTimer.current) clearTimeout(priceTimer.current);
    priceTimer.current = null;
    commit(clearFilters({ ...state, q: normalizedDraft }));
  };
  const openFilters = () => {
    if (showFilters) { setShowFilters(false); return; }
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
      {wishlist?.error && <p role="alert">{wishlist.error}</p>}
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link to="/">Home</Link><ChevronRight size={16} aria-hidden="true" />
        {activeCategory && <><Link to={allProductsLink}>Products</Link><ChevronRight size={16} aria-hidden="true" /></>}
        <span aria-current="page">{pageTitle}</span></nav>
      <div className={styles.titleRow}>
        <h1 className={styles.pageTitle}>{pageTitle}</h1>
        {catalog && results && (
          <span className={styles.resultCount}>{results.meta.total} {results.meta.total === 1 ? 'product' : 'products'}</span>
        )}
      </div>
      {!catalog && <p className={styles.subtitle}>Find laptops, phones, audio, and more.</p>}
      <Tabs value={tab} onValueChange={setTab}>
        {!catalog && <TabsList className={styles.tabs} aria-label="Search method"><TabsTrigger value="text">Text Search</TabsTrigger><TabsTrigger value="image">Image Search</TabsTrigger></TabsList>}
        <TabsContent value="text">
          <div className={catalog ? styles.catalogToolbar : styles.searchToolbar}>
            <form role="search" className={styles.searchForm + (catalog ? ' ' + styles.catalogSearch : '')} onSubmit={event => { event.preventDefault(); if (draftTimer.current) clearTimeout(draftTimer.current); draftTimer.current = null; if (normalizedDraft !== state.q) commit({ ...state, q: normalizedDraft, page: 1 }, true); }}>
              <SearchField value={draft} onChange={changeDraft} onSelect={selectSuggestion} />
            </form>
            {catalog && <button ref={filterButton} type="button" className={`${styles.filterTrigger} ${showFilters || filterCount ? styles.filterTriggerActive : ''}`}
              aria-expanded={showFilters} aria-controls="search-filters" aria-label={filterCount ? `Filters (${filterCount})` : 'Filters'} onClick={openFilters}>
              <SlidersHorizontal size={20} strokeWidth={1.75} aria-hidden="true" /><span>Filters</span>
              {filterCount > 0 && <span className={styles.filterBadge} aria-hidden="true">{filterCount}</span>}
              <ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" className={`${styles.chevron} ${showFilters ? styles.chevronOpen : ''}`} />
            </button>}
            <FilterSelect label="Sort by" value={state.sort ?? defaultSort} selectSize={catalog ? 'medium' : 'large'}
              compact={catalog ? { icon: <ArrowUpDown size={20} strokeWidth={1.75} />, triggerClassName: styles.sortTrigger ?? '', contentClassName: styles.sortContent ?? '' } : undefined} choices={[
              ...(catalog ? [{ value: 'category-mix', label: 'Category mix' }] : []), { value: 'relevance', label: 'Relevance' }, { value: 'price-asc', label: 'Price: low to high' }, { value: 'price-desc', label: 'Price: high to low' }, { value: 'newest', label: 'Newest' }, { value: 'name-asc', label: 'Name: A–Z' },
            ]} onChange={value => update({ sort: value as SearchState['sort'] })} />
          </div>
          {(parsed.error || formError) && <div role="alert" className={styles.error}>{parsed.error || formError}
            {parsed.error && <Button type="button" variant="link" onClick={() => setParams({})}>Clear search</Button>}</div>}
          {catalog && showFilters && <section ref={filterPanel} tabIndex={-1} id="search-filters" aria-label="Product filters" className={styles.toolbar}
            onKeyDown={event => { if (event.key === 'Escape') { setShowFilters(false); filterButton.current?.focus(); } }}>
            {(categoriesQuery.isPending || brandsQuery.isPending) && <p role="status">Loading filters…</p>}
            {metadataError && <p role="status">Filters are temporarily unavailable. You can still search by text. <Button type="button" variant="link" onClick={() => { void categoriesQuery.refetch(); void brandsQuery.refetch(); }}>Retry filters</Button></p>}
            <div className={styles.filterRow}>
              <FilterSelect label="Category" value={state.category ?? ''} choices={[{ value: '', label: 'All categories' }, ...filterChoices(categories, state.category)]} onChange={value => update({ category: value || undefined })} />
              <FilterSelect label="Brand" value={state.brand ?? ''} choices={[{ value: '', label: 'All brands' }, ...filterChoices(brands, state.brand)]} onChange={value => update({ brand: value || undefined })} />
              <FilterSelect label="Availability" value={state.availability ?? ''} choices={[{ value: '', label: 'Any availability' }, { value: 'available', label: 'Available' }, { value: 'unavailable', label: 'Unavailable' }]} onChange={value => update({ availability: value === 'available' || value === 'unavailable' ? value : undefined })} />
              <Input label="Min price ($)" aria-invalid={priceInvalid || undefined} inputMode="decimal" value={priceDraft.minPrice ?? ''} onChange={event => changePrice({ minPrice: event.target.value || undefined })} />
              <Input label="Max price ($)" aria-invalid={priceInvalid || undefined} inputMode="decimal" value={priceDraft.maxPrice ?? ''} onChange={event => changePrice({ maxPrice: event.target.value || undefined })} />
            </div>
            {filterCount > 0 && <div className={styles.filterActions}>
              <Button type="button" variant="ghost" size="small" onClick={clearAllFilters}>Clear all filters</Button>
            </div>}
          </section>}
          {catalog && filterCount > 0 && <div className={styles.activeFilters} role="group" aria-label="Active filters">
            {state.category && <button type="button" onClick={() => removeFilter({ category: undefined })} aria-label={`Remove category filter ${categories.find(value => value.slug === state.category)?.name ?? state.category}`}>{categories.find(value => value.slug === state.category)?.name ?? state.category} ×</button>}
            {state.brand && <button type="button" onClick={() => removeFilter({ brand: undefined })} aria-label={`Remove brand filter ${brands.find(value => value.slug === state.brand)?.name ?? state.brand}`}>{brands.find(value => value.slug === state.brand)?.name ?? state.brand} ×</button>}
            {state.availability && <button type="button" onClick={() => removeFilter({ availability: undefined })} aria-label={`Remove availability filter ${state.availability}`}>{state.availability === 'available' ? 'Available' : 'Unavailable'} ×</button>}
            {priceText && <button type="button" onClick={() => removeFilter({ minPrice: undefined, maxPrice: undefined })} aria-label={`Remove price filter ${priceText}`}>{priceText} ×</button>}
            <button type="button" className={styles.clearAll} onClick={clearAllFilters}>Clear all</button>
          </div>}
          <section aria-label="Search results" aria-busy={loading || (active && tab === 'text' && searchQuery.isFetching) || undefined} className={styles.results}>
            <div role="status" aria-live="polite" className={catalog ? styles.visuallyHidden : undefined}>{loading ? 'Searching products…' : results ? `${results.meta.total} ${results.meta.total === 1 ? 'result' : 'results'}${state.q ? ` for “${state.q}”` : ''}` : ''}</div>
            {loading && <div className={`${styles.grid} ${catalog ? styles.catalogGrid : ''}`} aria-hidden="true">{Array.from({ length: getProductGridSkeletonCount(state.pageSize) }, (_, index) => <ProductCardSkeleton key={index} />)}</div>}
            {error && <ErrorState headingLevel={2} className={styles.stateBlock} title="Search unavailable" description="Search is temporarily unavailable. Please try again." action={<Button type="button" onClick={() => void searchQuery.refetch()}>Retry search</Button>} />}
            {results && results.data.length > 0 && <div className={`${styles.grid} ${catalog ? styles.catalogGrid : ''}`}>{results.data.map((product, index) => catalog
              ? <StaggerItem key={product.id} replay index={index % 4}><ProductCard {...productCardProps(product)} isWishlisted={wishlist?.productIds.includes(product.id)} wishlistPending={wishlist?.pending.includes(product.id)} onToggleWishlist={wishlist ? (id, summary) => wishlist.toggle(String(id), summary) : undefined} onNavigate={navigate} onAddToCart={() => addItem(product.id)} /></StaggerItem>
              : <ProductCard key={product.id} {...productCardProps(product)} isWishlisted={wishlist?.productIds.includes(product.id)} wishlistPending={wishlist?.pending.includes(product.id)} onToggleWishlist={wishlist ? (id, summary) => wishlist.toggle(String(id), summary) : undefined} onNavigate={navigate} onAddToCart={() => addItem(product.id)} />)}</div>}
            {results && results.data.length === 0 && <EmptyState headingLevel={2} className={styles.stateBlock} icon={<SearchX aria-hidden="true" />} title={state.q ? `No results for “${state.q}”` : 'No products found'} description="Try adjusting your search or filters." action={<>{catalog && filterCount > 0 && <Button type="button" variant="link" onClick={clearAllFilters}>Reset filters</Button>}{state.q && <Button type="button" variant="link" onClick={() => { setDraft(''); update({ q: '' }); }}>Clear query</Button>}{state.page > 1 && <Button type="button" variant="link" onClick={() => commit({ ...state, page: 1 })}>First page</Button>}</>} />}
            {totalPages > 1 && <Pagination aria-label="Search result pages"><PaginationContent>
              <PaginationItem><PaginationPrevious disabled={state.page <= 1} onClick={() => commit({ ...state, page: state.page - 1 }, false, true)} /></PaginationItem>
              {pages.map(page => <PaginationItem key={page}><PaginationLink aria-label={`Go to page ${page}`} isActive={page === state.page} onClick={() => commit({ ...state, page }, false, true)}>{page}</PaginationLink></PaginationItem>)}
              <PaginationItem><PaginationNext disabled={state.page >= totalPages} onClick={() => commit({ ...state, page: state.page + 1 }, false, true)} /></PaginationItem>
            </PaginationContent></Pagination>}
          </section>
        </TabsContent>
        {!catalog && <TabsContent value="image"><ImageSearchShell /></TabsContent>}
      </Tabs>
    </div>
  </>;
}
