import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date, pattern: string = 'dd/MM/yyyy'): string {
  if (!date) return '-';
  return format(new Date(date), pattern, { locale: es });
}

export function formatDateTime(date: string | Date): string {
  if (!date) return '-';
  return format(new Date(date), "dd/MM/yyyy HH:mm", { locale: es });
}

export function formatRelativeDate(date: string | Date): string {
  if (!date) return '-';
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: es });
}

export function formatNumber(num: number): string {
  if (num === null || num === undefined) return '-';
  return new Intl.NumberFormat('es-AR').format(num);
}

export function formatPercentage(num: number): string {
  if (num === null || num === undefined) return '-';
  return new Intl.NumberFormat('es-AR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(num / 100);
}

export function truncate(str: string, length: number): string {
  if (!str) return '';
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

export function getInitials(name: string): string {
  if (!name) return '??';
  return name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function getScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600 bg-emerald-50';
  if (score >= 60) return 'text-blue-600 bg-blue-50';
  if (score >= 40) return 'text-amber-600 bg-amber-50';
  if (score >= 20) return 'text-orange-600 bg-orange-50';
  return 'text-red-600 bg-red-50';
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    activo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    inactive: 'bg-slate-50 text-slate-600 border-slate-200',
    inactivo: 'bg-slate-50 text-slate-600 border-slate-200',
    new: 'bg-blue-50 text-blue-700 border-blue-200',
    nuevo: 'bg-blue-50 text-blue-700 border-blue-200',
    contacted: 'bg-purple-50 text-purple-700 border-purple-200',
    contactado: 'bg-purple-50 text-purple-700 border-purple-200',
    qualified: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    calificado: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    converted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    convertido: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    lost: 'bg-red-50 text-red-700 border-red-200',
    perdido: 'bg-red-50 text-red-700 border-red-200',
    draft: 'bg-slate-50 text-slate-600 border-slate-200',
    borrador: 'bg-slate-50 text-slate-600 border-slate-200',
    running: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ejecutando: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    paused: 'bg-amber-50 text-amber-700 border-amber-200',
    pausado: 'bg-amber-50 text-amber-700 border-amber-200',
    completed: 'bg-blue-50 text-blue-700 border-blue-200',
    completado: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  return colors[status?.toLowerCase()] || 'bg-slate-50 text-slate-600 border-slate-200';
}

export function getTierColor(tier: string): string {
  const colors: Record<string, string> = {
    A: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    B: 'bg-blue-50 text-blue-700 border-blue-200',
    C: 'bg-amber-50 text-amber-700 border-amber-200',
    D: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  return colors[tier?.toUpperCase()] || 'bg-slate-50 text-slate-600 border-slate-200';
}
