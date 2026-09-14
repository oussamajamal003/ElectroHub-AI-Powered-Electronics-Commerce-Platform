import { MoreHorizontal } from 'lucide-react';
import styles from './DataTable.module.scss';

export interface Column<T> {
  key: string;
  title: string;
  render?: (item: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T) => string | number;
  onRowClick?: (item: T) => void;
  onActionClick?: (item: T, event: React.MouseEvent) => void;
  emptyMessage?: string;
  className?: string;
}

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  onRowClick,
  onActionClick,
  emptyMessage = 'No data available',
  className = '',
}: DataTableProps<T>) {
  return (
    <div className={`${styles.tableContainer} ${className}`} data-testid="data-table">
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${styles.th} ${col.align ? styles[`align-${col.align}`] : ''}`}
                style={{ width: col.width }}
                scope="col"
              >
                {col.title}
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
          {data.length === 0 ? (
            <tr>
              <td 
                colSpan={columns.length + (onActionClick ? 1 : 0)} 
                className={styles.emptyState}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item) => (
              <tr 
                key={keyExtractor(item)} 
                className={`${styles.tr} ${onRowClick ? styles.clickable : ''}`}
                onClick={() => onRowClick?.(item)}
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
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
