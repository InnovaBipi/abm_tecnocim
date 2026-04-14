import React from 'react';
import { cn } from '@/lib/utils';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle, Trash2, Info } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  loading?: boolean;
}

const variantConfig: Record<string, {
  icon: React.ReactNode;
  iconBg: string;
  buttonVariant: 'danger' | 'primary';
}> = {
  danger: {
    icon: <Trash2 className="h-6 w-6 text-red-600" />,
    iconBg: 'bg-red-100',
    buttonVariant: 'danger',
  },
  warning: {
    icon: <AlertTriangle className="h-6 w-6 text-amber-600" />,
    iconBg: 'bg-amber-100',
    buttonVariant: 'danger',
  },
  info: {
    icon: <Info className="h-6 w-6 text-blue-600" />,
    iconBg: 'bg-blue-100',
    buttonVariant: 'primary',
  },
};

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  loading = false,
}: ConfirmDialogProps) {
  const config = variantConfig[variant];

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="flex flex-col items-center text-center py-2">
        <div
          className={cn(
            'flex items-center justify-center w-14 h-14 rounded-full mb-4',
            config.iconBg
          )}
        >
          {config.icon}
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
        {description && (
          <p className="text-sm text-slate-500 mb-6 max-w-xs">{description}</p>
        )}
        <div className="flex items-center gap-3 w-full">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={config.buttonVariant}
            className="flex-1"
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
