import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal } from 'lucide-react';
import styles from './DataTable.module.scss';

export interface Column<T> {
  key: string;
  title: string;
  render?: (item: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
  /** Server sort key; when set and `onSortChange` is provided the header becomes a sort button with aria-sort. */
  sortKey?: string;
}

export interface DataTableSort { key: string; order: 'asc' | 'desc' }
export interface DataTableRowAttributes { id?: string; tabIndex?: number; 'aria-label'?: string; className?: string }

export interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T) => string | number;
  onRowClick?: (item: T) => void;
  onActionClick?: (item: T, event: React.MouseEvent) => void;
  emptyMessage?: React.ReactNode;
  className?: string;
  caption?: string;
  sort?: DataTableSort;
  onSortChange?: (sort: DataTableSort) => void;
  /** Renders this many skeleton rows instead of data (first load only: never a false empty state). */
  loadingRows?: number;
  /** Optional stable row attributes for deep-link focus and other table-specific navigation affordances. */
  rowAttributes?: (item: T) => DataTableRowAttributes | undefined;
}

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  onRowClick,
  onActionClick,
  emptyMessage = 'No data available',
  className = '',
  caption,
  sort,
  onSortChange,
  loadingRows,
  rowAttributes,
}: DataTableProps<T>) {
  const ariaSort = (col: Column<T>) => !col.sortKey || !onSortChange ? undefined
    : sort?.key === col.sortKey ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <div className={`${styles.tableContainer} ${className}`} data-testid="data-table">
      <table className={styles.table}>
        {caption && <caption className={styles.caption}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${styles.th} ${col.align ? styles[`align-${col.align}`] : ''}`}
                style={{ width: col.width }}
                scope="col"
                aria-sort={ariaSort(col)}
              >
                {col.sortKey && onSortChange ? (
                  <button
                    type="button"
                    className={styles.sortButton}
                    onClick={() => onSortChange({ key: col.sortKey!, order: sort?.key === col.sortKey && sort?.order === 'asc' ? 'desc' : 'asc' })}
                  >
                    {col.title}
                    {sort?.key === col.sortKey
                      ? (sort.order === 'asc' ? <ArrowUp className={styles.sortIcon} aria-hidden="true" /> : <ArrowDown className={styles.sortIcon} aria-hidden="true" />)
                      : <ArrowUpDown className={`${styles.sortIcon} ${styles.sortIdle}`} aria-hidden="true" />}
                  </button>
                ) : col.title}
              </th>
            ))}
            {onActionClick && (
              <th className={`${styles.th} ${styles.actionsHeader}`} scope="col">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {loadingRows ? (
            Array.from({ length: loadingRows }, (_, row) => (
              <tr key={`skeleton-${row}`} className={styles.tr} aria-hidden="true">
                {columns.map(col => <td key={col.key} className={styles.td}><span className={styles.skeleton} /></td>)}
                {onActionClick && <td className={styles.td} />}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td 
                colSpan={columns.length + (onActionClick ? 1 : 0)} 
                className={styles.emptyState}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item) => {
              const attributes = rowAttributes?.(item);
              return <tr
                key={keyExtractor(item)} 
                id={attributes?.id}
                tabIndex={attributes?.tabIndex}
                aria-label={attributes?.['aria-label']}
                className={`${styles.tr} ${onRowClick ? styles.clickable : ''} ${attributes?.className ?? ''}`}
                // Links and buttons inside a clickable row keep their own action instead of also triggering the row.
                onClick={event => { if (!(event.target as HTMLElement).closest('a, button, input, select, textarea, label')) onRowClick?.(item); }}
              >
                {columns.map((col) => (
                  <td 
                    key={col.key} 
                    className={`${styles.td} ${col.align ? styles[`align-${col.align}`] : ''}`}
                  >
                    {col.render ? col.render(item) : (item as Record<string, unknown>)[col.key] as React.ReactNode}
                  </td>
                ))}
                {onActionClick && (
                  <td className={`${styles.td} ${styles.actionsCell}`}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onActionClick(item, e);
                      }}
                      aria-label="Actions"
                    >
                      <MoreHorizontal className={styles.actionIcon} />
                    </button>
                  </td>
                )}
              </tr>;
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
