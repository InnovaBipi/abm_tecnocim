import React from 'react';
import { cn } from '@/lib/utils';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const sizeConfig: Record<string, { track: string; thumb: string; translate: string }> = {
  sm: {
    track: 'w-8 h-4',
    thumb: 'w-3 h-3',
    translate: 'translate-x-4',
  },
  md: {
    track: 'w-11 h-6',
    thumb: 'w-5 h-5',
    translate: 'translate-x-5',
  },
};

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
  className,
}: ToggleProps) {
  const config = sizeConfig[size];

  return (
    <label
      className={cn(
        'flex items-start gap-3 cursor-pointer',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative inline-flex shrink-0 rounded-full transition-colors duration-200 ease-in-out',
          'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
          config.track,
          checked ? 'bg-primary-600' : 'bg-slate-300'
        )}
      >
        <span
          className={cn(
            'inline-block rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out',
            config.thumb,
            'translate-y-0.5 translate-x-0.5',
            checked && config.translate
          )}
        />
      </button>
      {(label || description) && (
        <div className="flex-1 min-w-0">
          {label && (
            <span className="text-sm font-medium text-slate-900">{label}</span>
          )}
          {description && (
            <p className="text-sm text-slate-500 mt-0.5">{description}</p>
          )}
        </div>
      )}
    </label>
  );
}
