import { useEffect } from 'react';
import { cn } from '@/components/ui/cn';
import { useToastStore } from '@/stores/toastStore';

export function Toaster() {
  const { toasts, removeToast } = useToastStore();

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-[100] flex flex-col gap-2',
        'pointer-events-none',
      )}
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.map((toastItem) => (
        <Toast
          key={toastItem.id}
          toast={toastItem}
          onClose={() => removeToast(toastItem.id)}
        />
      ))}
    </div>
  );
}

interface ToastProps {
  toast: {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    description?: string;
    duration?: number;
  };
  onClose: () => void;
}

function Toast({ toast: toastItem, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, toastItem.duration ?? 5000);
    return () => clearTimeout(timer);
  }, [onClose, toastItem.duration]);

  const typeStyles = {
    success: 'border-l-4 border-green-500 bg-green-950/50',
    error: 'border-l-4 border-red-500 bg-red-950/50',
    warning: 'border-l-4 border-yellow-500 bg-yellow-950/50',
    info: 'border-l-4 border-blue-500 bg-blue-950/50',
  };

  const iconStyles = {
    success: 'text-green-400',
    error: 'text-red-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
  };

  return (
    <div
      className={cn(
        'relative flex items-start gap-3 p-4 rounded-lg border shadow-lg',
        'w-[min(300px,calc(100vw-2rem))] max-w-md',
        'pointer-events-auto',
        'animate-in slide-in-from-right-full duration-300',
        typeStyles[toastItem.type]
      )}
      role="alert"
    >
      <div className={cn('flex-shrink-0 mt-0.5', iconStyles[toastItem.type])}>
        {toastItem.type === 'success' && (
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {toastItem.type === 'error' && (
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {toastItem.type === 'warning' && (
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {toastItem.type === 'info' && (
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{toastItem.title}</p>
        {toastItem.description && (
          <p className="text-sm text-gray-300 mt-1">{toastItem.description}</p>
        )}
      </div>
      <button
        onClick={onClose}
        className={cn(
          'flex-shrink-0 p-1 rounded hover:bg-white/10 transition-colors',
          'text-gray-400 hover:text-white'
        )}
        aria-label="Dismiss"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}