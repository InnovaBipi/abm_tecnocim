import React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
}

export function Skeleton({ className, width, height }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-lg bg-slate-200',
        className
      )}
      style={{ width, height }}
    />
  );
}

interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-4',
            i === lines - 1 ? 'w-3/4' : 'w-full'
          )}
        />
      ))}
    </div>
  );
}

interface SkeletonCardProps {
  className?: string;
  hasIcon?: boolean;
}

export function SkeletonCard({ className, hasIcon = true }: SkeletonCardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-xl border border-slate-200 shadow-sm p-5',
        className
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-4 w-24" />
        {hasIcon && <Skeleton className="h-9 w-9 rounded-lg" />}
      </div>
      <Skeleton className="h-8 w-20 mb-1" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({ rows = 5, columns = 5, className }: SkeletonTableProps) {
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-slate-200 bg-slate-50">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="flex items-center gap-4 px-6 py-4 border-b border-slate-100 last:border-0"
        >
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton
              key={colIdx}
              className={cn(
                'h-4 flex-1',
                colIdx === 0 && 'max-w-[180px]',
                colIdx === columns - 1 && 'max-w-[80px]'
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface SkeletonChartProps {
  className?: string;
  height?: string;
}

export function SkeletonChart({ className, height = '240px' }: SkeletonChartProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-xl border border-slate-200 shadow-sm p-5',
        className
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
      <div className="flex items-end gap-2" style={{ height }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1 rounded-t-md"
            height={`${30 + Math.random() * 70}%`}
          />
        ))}
      </div>
    </div>
  );
}
