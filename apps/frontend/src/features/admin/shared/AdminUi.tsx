import { useEffect, useState, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Minus, RotateCcw, Search, TrendingDown, TrendingUp, X, XCircle } from 'lucide-react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { ToastCenter, toast } from '@/components/ui/Toast';
import { errorMessage, type PageMeta } from './api';
import { formatCount, stockLabel } from './format';
import { scrollToContentTop } from './scroll';
import buttonStyles from '@/components/ui/Button/Button.module.scss';
import styles from './AdminUi.module.scss';

// ─── Page header + breadcrumbs ───────────────────────────
export interface Crumb { label: string; to?: string }
export function PageHeader({ title, description, crumbs, actions }: { title: ReactNode; description?: ReactNode; crumbs?: Crumb[]; actions?: ReactNode }) {
  return <header className={styles.pageHeader}>
    {crumbs && crumbs.length > 0 && <Breadcrumb className={styles.crumbs}>
      <BreadcrumbList className={styles.crumbList}>
        {crumbs.map((crumb, index) => <BreadcrumbItem key={`${crumb.label}-${index}`} className={styles.crumb}>
          {crumb.to && index < crumbs.length - 1
            ? <Link to={crumb.to} className={styles.crumbLink}>{crumb.label}</Link>
            : <span aria-current="page" className={styles.crumbCurrent} title={crumb.label}>{crumb.label}</span>}
          {index < crumbs.length - 1 && <ChevronRight className={styles.crumbSeparator} aria-hidden="true" />}
        </BreadcrumbItem>)}
      </BreadcrumbList>
    </Breadcrumb>}
    <div className={styles.titleRow}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  </header>;
}

/** Navigation styled as the shared Button (reuses its stylesheet; a real link, so it opens in a new tab and has link semantics). */
export function ButtonLink({ variant = 'primary', size = 'medium', className, children, ...props }: LinkProps & {
  variant?: 'primary' | 'outline' | 'secondary'; size?: 'small' | 'medium';
}) {
  return <Link className={clsx(buttonStyles.button, buttonStyles[`variant-${variant}`], buttonStyles[`size-${size}`], styles.buttonLink, className)} {...props}>
    <span className={buttonStyles.content}>{children}</span>
  </Link>;
}

// ─── Filter band (search + chips + reset) ─────────────────
export interface Chip { value: string | undefined; label: string; count?: number }
export function FilterBand({ search, onSearch, placeholder, searchLabel, chips, active, onChip, onReset, resetDisabled, children }: {
  search: string; onSearch: (value: string) => void; placeholder: string; searchLabel: string;
  chips?: Chip[]; active?: string; onChip?: (value: string | undefined) => void; onReset: () => void; resetDisabled?: boolean; children?: ReactNode;
}) {
  // The clicked chip shows as selected at once; the URL update (and the list render it triggers) follows as a router transition.
  const [picked, setPicked] = useState<{ value: string | undefined } | null>(null);
  useEffect(() => { setPicked(null); }, [active]);
  const selected = picked ? picked.value : active;
  return <div className={styles.filterBand} role="search" aria-label={searchLabel}>
    <label className={styles.searchField}>
      <span className={styles.visuallyHidden}>{searchLabel}</span>
      <Search className={styles.searchIcon} aria-hidden="true" />
      <input type="search" value={search} placeholder={placeholder} maxLength={100} onChange={event => onSearch(event.target.value)}
        className={styles.searchInput} />
      {search && <button type="button" className={styles.searchClear} onClick={() => onSearch('')} aria-label="Clear search"><X aria-hidden="true" /></button>}
    </label>
    {chips && onChip && <div className={styles.chips} role="group" aria-label="Filter">
      {chips.map(chip => <button key={chip.label} type="button" className={clsx(styles.chip, selected === chip.value && styles.chipActive)}
        aria-pressed={selected === chip.value} onClick={() => { setPicked({ value: chip.value }); onChip(chip.value); }}>
        {chip.label}{chip.count !== undefined && <span className={styles.chipCount}>{formatCount(chip.count)}</span>}
      </button>)}
    </div>}
    {children}
    <button type="button" className={styles.resetButton} onClick={onReset} disabled={resetDisabled}>
      <RotateCcw aria-hidden="true" /> Reset
    </button>
  </div>;
}

// ─── KPI card ─────────────────────────────────────────────
export type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'primary';
/** `value === null` renders a skeleton (still loading) or a dash (unavailable): never a misleading zero. */
/** Change against the previous period plus what was added today. No previous value means there is nothing to compare with. */
export interface KpiTrendValue { current: number; previous: number; today: ReactNode; period: string }
function KpiTrend({ trend }: { trend: KpiTrendValue }) {
  const change = trend.previous > 0 ? ((trend.current - trend.previous) / trend.previous) * 100 : null;
  const direction = change === null ? (trend.current > 0 ? 'up' : 'flat') : change > 0.05 ? 'up' : change < -0.05 ? 'down' : 'flat';
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
  const percent = change === null ? (trend.current > 0 ? 'New' : '0%') : `${change > 0 ? '+' : ''}${change.toFixed(Math.abs(change) < 10 ? 1 : 0)}%`;
  return <span className={styles.kpiTrend}>
    <span className={clsx(styles.kpiChange, styles[`change-${direction}`])} title={`Compared with the ${trend.period}`}>
      <Icon aria-hidden="true" />{percent}<span className={styles.kpiMuted}>vs {trend.period}</span></span>
    <span className={styles.kpiToday}>{trend.today} today</span>
  </span>;
}

export function KpiCard({ label, value, tone = 'neutral', icon, hint, trend, to, loading, centered }: {
  label: string; value: ReactNode | null; tone?: Tone; icon?: ReactNode; hint?: ReactNode; trend?: KpiTrendValue; to?: string; loading?: boolean; centered?: boolean;
}) {
  const body = <>
    <div className={styles.kpiTop}>
      <span className={styles.kpiLabel}>{label}</span>
      {icon && <span className={clsx(styles.kpiIcon, styles[`tone-${tone}`])} aria-hidden="true">{icon}</span>}
    </div>
    <strong className={clsx(styles.kpiValue, styles[`text-${tone}`])}>
      {loading ? <span className={styles.kpiSkeleton} aria-label="Loading" /> : value ?? <span aria-label="Unavailable">—</span>}
    </strong>
    {trend && !loading && <KpiTrend trend={trend} />}
    {hint && <span className={styles.kpiHint}>{hint}</span>}
  </>;
  return to ? <Link to={to} className={clsx(styles.kpi, styles.kpiLink, centered && styles.kpiCentered)}>{body}</Link>
    : <div className={clsx(styles.kpi, centered && styles.kpiCentered)}>{body}</div>;
}

// ─── Status pills ─────────────────────────────────────────
const toneIcon: Partial<Record<Tone, typeof CheckCircle2>> = { success: CheckCircle2, warning: AlertTriangle, error: XCircle, info: Info };
export function StatusPill({ tone, children, icon = true }: { tone: Tone; children: ReactNode; icon?: boolean }) {
  const Icon = toneIcon[tone];
  return <span className={clsx(styles.pill, styles[`tone-${tone}`])}>{icon && Icon && <Icon aria-hidden="true" />}{children}</span>;
}
export function StockPill({ status }: { status: string | null }) {
  if (!status) return <StatusPill tone="neutral">Not tracked</StatusPill>;
  return <StatusPill tone={status === 'IN_STOCK' ? 'success' : status === 'LOW_STOCK' ? 'warning' : 'error'}>{stockLabel[status] ?? status}</StatusPill>;
}
export function ActivePill({ active, activeLabel = 'Active', inactiveLabel = 'Inactive' }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return <StatusPill tone={active ? 'success' : 'neutral'} icon={false}>{active ? activeLabel : inactiveLabel}</StatusPill>;
}

// ─── Table surface, pagination, errors ────────────────────
export function TableCard({ children, busy, label }: { children: ReactNode; busy?: boolean; label?: string }) {
  return <section className={styles.tableCard} aria-busy={busy || undefined} aria-label={label}>{children}</section>;
}

export function Pager({ meta, onPage, disabled, label }: { meta: PageMeta | undefined; onPage: (page: number) => void; disabled?: boolean; label: string }) {
  // A page past the end (bookmark, or rows deleted since) moves to the last real page instead of showing an empty list.
  const beyond = meta && meta.totalPages > 0 && meta.page > meta.totalPages ? meta.totalPages : null;
  useEffect(() => { if (beyond) onPage(beyond); }, [beyond, onPage]);
  if (!meta || meta.total === 0 || beyond) return null;
  // The live summary below announces the new range; focus stays on the button so Next can be pressed again.
  const go = (page: number) => { onPage(page); scrollToContentTop(); };
  const start = (meta.page - 1) * meta.pageSize + 1;
  const end = Math.min(meta.total, meta.page * meta.pageSize);
  return <nav className={styles.pager} aria-label={label}>
    <span className={styles.pagerSummary} aria-live="polite">Showing {formatCount(start)}–{formatCount(end)} of {formatCount(meta.total)}</span>
    {meta.totalPages > 1 && <div className={styles.pagerControls}>
      <Button type="button" variant="outline" size="small" disabled={disabled || meta.page <= 1} onClick={() => go(meta.page - 1)}>
        <ChevronLeft aria-hidden="true" size={16} /> Previous
      </Button>
      <span className={styles.pagerPage}>Page {meta.page} of {meta.totalPages}</span>
      <Button type="button" variant="outline" size="small" disabled={disabled || meta.page >= meta.totalPages} onClick={() => go(meta.page + 1)}>
        Next <ChevronRight aria-hidden="true" size={16} />
      </Button>
    </div>}
  </nav>;
}

/** Blocking error when nothing is loaded yet; a non-blocking stale notice when the last good data is still shown. */
export function QueryProblem({ error, hasData, onRetry, retrying, what }: { error: unknown; hasData: boolean; onRetry: () => void; retrying?: boolean; what: string }) {
  return <div className={clsx(styles.problem, hasData && styles.problemStale)} role="alert">
    <AlertTriangle aria-hidden="true" className={styles.problemIcon} />
    <div className={styles.problemText}>
      <strong>{hasData ? `${what} could not be refreshed.` : `${what} could not be loaded.`}</strong>
      <span>{hasData ? 'Showing the last loaded results. ' : ''}{errorMessage(error)}</span>
    </div>
    <Button type="button" variant="outline" size="small" onClick={onRetry} isLoading={retrying}>Retry</Button>
  </div>;
}

export function EmptyRows({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return <div className={styles.empty}><strong>{title}</strong>{hint && <span>{hint}</span>}{action}</div>;
}

/** A failed first load is not an empty list: say the rows could not be loaded (the QueryProblem above offers Retry), never "No … yet". */
export function ListEmpty({ failed, children }: { failed: boolean; children: ReactNode }) {
  return failed ? <EmptyRows title="These rows could not be loaded" hint="Use Retry above to try again." /> : <>{children}</>;
}

// ─── Confirmation dialog ──────────────────────────────────
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, pending, error, onConfirm, children, confirmDisabled }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: ReactNode; confirmLabel: string; destructive?: boolean;
  pending?: boolean; error?: string | null; onConfirm: () => void; children?: ReactNode;
  /** Keeps the confirm action disabled until the caller's own input (e.g. a typed confirmation) is valid. */
  confirmDisabled?: boolean;
}) {
  return <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
    <DialogContent className={styles.dialog}>
      <DialogTitle className={styles.dialogTitle}>{title}</DialogTitle>
      <DialogDescription asChild><div className={styles.dialogBody}>{description}</div></DialogDescription>
      {children}
      {error && <p className={styles.dialogError} role="alert">{error}</p>}
      <div className={styles.dialogActions}>
        {/* Cancel is first in DOM order and receives initial focus: Enter never confirms a destructive action by accident. */}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending} autoFocus>Cancel</Button>
        <Button type="button" variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} isLoading={pending} disabled={confirmDisabled}>{confirmLabel}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

// ─── Toasts ───────────────────────────────────────────────
// Admin feedback uses the one central toast system (components/ui/Toast). `AdminToastProvider` stays as the page-level mount point so
// stories and isolated tests still render toasts; it is inert when the app-level ToastCenter already owns the viewport.
type AdminToastVariant = 'success' | 'error' | 'info' | 'warning';
export function AdminToastProvider({ children }: { children: ReactNode }) {
  return <>{children}<ToastCenter /></>;
}
const notifyAdmin = (title: string, variant: AdminToastVariant = 'success') => { toast[variant](title); };
// eslint-disable-next-line react-refresh/only-export-components
export const useAdminToast = () => notifyAdmin;

/** Neutral admin page placeholder (breadcrumb, title, two content blocks) shown while a page's code loads. */
export function AdminPageSkeleton() {
  return <div className={styles.pageSkeleton} aria-busy="true">
    <span role="status" className={styles.visuallyHidden}>Loading page…</span>
    <Skeleton width="12rem" height="0.875rem" /><Skeleton width="min(22rem, 70%)" height="2.75rem" /><Skeleton width="min(28rem, 85%)" height="0.875rem" />
    <Skeleton height="6rem" /><Skeleton height="18rem" />
  </div>;
}
