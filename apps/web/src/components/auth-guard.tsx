'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Spinner } from './ui';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      const next = encodeURIComponent(pathname);
      router.replace(`/login?next=${next}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f6f8f7]">
        <div className="flex flex-col items-center gap-3 text-ink-500">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-700 text-lg font-black text-white">
            K<span className="text-accent-300">.</span>
          </span>
          <span className="flex items-center gap-2 text-sm">
            <Spinner /> Loading your workspace…
          </span>
        </div>
      </div>
    );
  }

  if (!user) return null;
  return <>{children}</>;
}
