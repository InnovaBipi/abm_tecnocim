import React from 'react';
import { cn } from '@/lib/utils';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

export type SortDirection = 'asc' | 'desc' | null;

interface SortableHeaderProps {
  label: string;
  field: string;
  currentSort: string | null;
  currentDirection: SortDirection;
  onSort: (field: string, direction: SortDirection) => void;
  className?: string;
}

export function SortableHeader({
  label,
  field,
  currentSort,
  currentDirection,
  onSort,
  className,
}: SortableHeaderProps) {
  const isActive = currentSort === field;

  const handleClick = () => {
    if (!isActive) {
      onSort(field, 'asc');
    } else if (currentDirection === 'asc') {
      onSort(field, 'desc');
    } else {
      onSort(field, null);
    }
  };

  return (
    <th scope="col" className={cn('text-left', className)}>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider',
          'hover:text-slate-900 transition-colors',
          isActive ? 'text-slate-900' : 'text-slate-500'
        )}
      >
        {label}
        {isActive && currentDirection === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : isActive && currentDirection === 'desc' ? (
          <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />
        )}
      </button>
    </th>
  );
}
