'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth';
import { SyncProvider } from '@/lib/offline/sync';
import { ToastProvider } from './toast';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline shell caching is an enhancement; the API and IndexedDB still work.
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <SyncProvider>{children}</SyncProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
