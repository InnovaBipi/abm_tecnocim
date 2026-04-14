import React from 'react';
import { cn } from '@/lib/utils';

interface TimelineItem {
  id: string;
  icon: React.ReactNode;
  title: string;
  description?: string;
  timestamp: string;
  iconColor?: string;
}

interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

export function Timeline({ items, className }: TimelineProps) {
  if (items.length === 0) return null;

  return (
    <div className={cn('relative', className)}>
      {/* Vertical line */}
      <div className="absolute left-5 top-3 bottom-3 w-px bg-slate-200" />

      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.id} className="relative flex gap-4">
            {/* Icon node */}
            <div
              className={cn(
                'relative z-10 flex items-center justify-center w-10 h-10 rounded-full border-2 border-white shadow-sm shrink-0',
                item.iconColor || 'bg-slate-100 text-slate-500'
              )}
            >
              {item.icon}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-1">
              <p className="text-sm font-medium text-slate-900">{item.title}</p>
              {item.description && (
                <p className="text-sm text-slate-500 mt-0.5 truncate">{item.description}</p>
              )}
              <p className="text-xs text-slate-400 mt-1">{item.timestamp}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
