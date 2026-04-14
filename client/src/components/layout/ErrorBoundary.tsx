import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  handleGoBack = () => {
    this.setState({ hasError: false, error: null });
    window.history.back();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-red-100 text-red-500 mb-4">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">
            Algo ha ido mal
          </h2>
          <p className="text-sm text-slate-500 max-w-md mb-6">
            Se ha producido un error inesperado. Puedes intentar recargar la pagina o volver atras.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={this.handleGoBack}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Volver atras
            </button>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
            >
              Recargar pagina
            </button>
          </div>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="mt-6 p-4 bg-red-50 rounded-lg text-xs text-red-700 text-left max-w-lg overflow-auto">
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
