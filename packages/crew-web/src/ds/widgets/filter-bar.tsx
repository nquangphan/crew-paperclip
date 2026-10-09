// crew: tự dựng
import type * as React from 'react';
import { useT } from '@/i18n';
import { Button } from '../components/button';
import { Input } from '../components/input';
import { Search } from '../icons';

interface FilterBarProps {
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  /** Các bộ lọc khác (Select, Tabs…). */
  children?: React.ReactNode;
  onReset?: () => void;
}

function FilterBar({ search, children, onReset }: FilterBarProps) {
  const { t } = useT();
  return (
    <div data-slot="filter-bar" className="flex flex-wrap items-center gap-2 pb-3">
      {search ? (
        <div className="relative min-w-48 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="pl-8"
            value={search.value}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            onChange={(e) => search.onChange(e.target.value)}
          />
        </div>
      ) : null}
      {children}
      {onReset ? (
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t('filter.reset')}
        </Button>
      ) : null}
    </div>
  );
}

export type { FilterBarProps };
export { FilterBar };
