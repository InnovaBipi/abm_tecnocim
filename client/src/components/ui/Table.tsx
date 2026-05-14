import React from 'react';
import { cn } from '@/lib/utils';

interface TableProps {
  children: React.ReactNode;
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-slate-200', className)}>
      <table className="w-full text-sm">
        {children}
      </table>
    </div>
  );
}

interface TableHeadProps {
  children: React.ReactNode;
  className?: string;
}

export function TableHead({ children, className }: TableHeadProps) {
  return (
    <thead className={cn('bg-slate-50 border-b border-slate-200', className)}>
      {children}
    </thead>
  );
}

interface TableBodyProps {
  children: React.ReactNode;
  className?: string;
}

export function TableBody({ children, className }: TableBodyProps) {
  return (
    <tbody className={cn('divide-y divide-slate-100 bg-white', className)}>
      {children}
    </tbody>
  );
}

interface TableRowProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

export function TableRow({ children, className, onClick, hoverable = true }: TableRowProps) {
  return (
    <tr
      className={cn(
        hoverable && 'hover:bg-slate-50 transition-colors',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface TableCellProps {
  children: React.ReactNode;
  className?: string;
  isHeader?: boolean;
}

export function TableCell({ children, className, isHeader = false }: TableCellProps) {
  if (isHeader) {
    return (
      <th
        scope="col"
        className={cn(
          'px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider',
          className
        )}
      >
        {children}
      </th>
    );
  }

  return (
    <td className={cn('px-4 py-3.5 text-slate-700', className)}>
      {children}
    </td>
  );
}
