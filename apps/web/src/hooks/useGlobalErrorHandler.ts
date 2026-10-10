import { useEffect } from 'react';
import { toast } from '@/stores/toastStore';

export function useGlobalErrorHandler() {
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      toast.error('Something went wrong', 'Please refresh the page');
    };

    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error);
      toast.error('Something went wrong', 'Please refresh the page');
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);
}