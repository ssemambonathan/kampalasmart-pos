'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from './ui';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = ++counter;
      setToasts((current) => [...current.slice(-3), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 6500 : 4200);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
        aria-live="polite"
        role="status"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-pop animate-fade-in',
              item.tone === 'success'
                ? 'border-brand-200 bg-white text-ink-800'
                : item.tone === 'error'
                  ? 'border-red-200 bg-white text-ink-800'
                  : 'border-ink-200 bg-white text-ink-800',
            )}
          >
            {item.tone === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            ) : item.tone === 'error' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
            )}
            <p className="flex-1 text-sm">{item.message}</p>
            <button
              type="button"
              className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
