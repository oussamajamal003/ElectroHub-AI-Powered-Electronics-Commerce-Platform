import { Search, X } from 'lucide-react';
import { Input } from '../Input';
import { Select } from '../Select';
import { Button } from '../Button';
import styles from './FilterBar.module.scss';

export interface FilterOption {
  value: string;
  label: string;
}

export interface ActiveFilter {
  key: string;
  label: string;
  value: string;
}

export interface FilterBarProps {
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  categoryOptions?: FilterOption[];
  selectedCategory?: string;
  onCategoryChange?: (value: string) => void;
  statusOptions?: FilterOption[];
  selectedStatus?: string;
  onStatusChange?: (value: string) => void;
  onApply?: () => void;
  activeFilters?: ActiveFilter[];
  onClearFilter?: (key: string) => void;
  className?: string;
}

export function FilterBar({
  searchQuery = '',
  onSearchChange,
  categoryOptions = [],
  selectedCategory,
  onCategoryChange,
  statusOptions = [],
  selectedStatus,
  onStatusChange,
  onApply,
  activeFilters = [],
  onClearFilter,
  className = '',
}: FilterBarProps) {
  return (
    <div className={`${styles.filterBarContainer} ${className}`} data-testid="filter-bar">
      <div className={styles.controlsRow}>
        <div className={styles.searchWrapper}>
          <Search className={styles.searchIcon} />
          <Input 
            type="text" 
            placeholder="Search products" 
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className={styles.searchInput}
            aria-label="Search products"
          />
        </div>
        
        {categoryOptions.length > 0 && (
          <div className={styles.selectWrapper}>
            <Select 
              options={categoryOptions}
              value={selectedCategory}
              onValueChange={onCategoryChange}
              placeholder="Category"
              aria-label="Filter by category"
            />
          </div>
        )}
        
        {statusOptions.length > 0 && (
          <div className={styles.selectWrapper}>
            <Select 
              options={statusOptions}
              value={selectedStatus}
              onValueChange={onStatusChange}
              placeholder="Status"
              aria-label="Filter by status"
            />
          </div>
        )}
        
        <Button variant="primary" onClick={onApply} className={styles.applyBtn}>
          Apply
        </Button>
      </div>
      
      {activeFilters.length > 0 && (
        <div className={styles.activeFiltersRow}>
          {activeFilters.map(filter => (
            <div key={filter.key} className={styles.activeFilterChip}>
              <span className={styles.filterLabel}>{filter.label}</span>
              <button 
                type="button" 
                className={styles.clearFilterBtn}
                onClick={() => onClearFilter?.(filter.key)}
                aria-label={`Remove filter ${filter.label}`}
              >
                <X className={styles.clearIcon} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
