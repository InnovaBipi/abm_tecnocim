import { useState, useCallback } from 'react';

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  description?: string;
  onConfirm: () => void;
  variant?: 'danger' | 'warning' | 'info';
  confirmLabel?: string;
}

const initialState: ConfirmDialogState = {
  isOpen: false,
  title: '',
  onConfirm: () => {},
};

export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmDialogState>(initialState);

  const confirm = useCallback(
    (options: Omit<ConfirmDialogState, 'isOpen'>) => {
      setState({ ...options, isOpen: true });
    },
    []
  );

  const close = useCallback(() => {
    setState(initialState);
  }, []);

  const handleConfirm = useCallback(() => {
    state.onConfirm();
    close();
  }, [state, close]);

  return {
    dialogProps: {
      isOpen: state.isOpen,
      onClose: close,
      onConfirm: handleConfirm,
      title: state.title,
      description: state.description,
      variant: state.variant || ('danger' as const),
      confirmLabel: state.confirmLabel,
    },
    confirm,
  };
}
