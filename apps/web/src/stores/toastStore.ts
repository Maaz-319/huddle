import { create } from 'zustand';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  
  addToast: (toast) => {
    const id = Math.random().toString(36).slice(2, 9);
    const newToast = { ...toast, id };
    set((state) => ({ toasts: [...state.toasts, newToast] }));
    
    // Auto-remove after duration
    const duration = toast.duration ?? 5000;
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, duration);
    
    return id;
  },
  
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  
  clearToasts: () => set({ toasts: [] }),
}));

export function toast(options: Omit<Toast, 'id'>): string {
  return useToastStore.getState().addToast(options);
}

toast.success = (title: string, description?: string) =>
  toast({ type: 'success', title, description });
toast.error = (title: string, description?: string) =>
  toast({ type: 'error', title, description });
toast.warning = (title: string, description?: string) =>
  toast({ type: 'warning', title, description });
toast.info = (title: string, description?: string) =>
  toast({ type: 'info', title, description });