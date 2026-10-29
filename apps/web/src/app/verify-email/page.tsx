'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { AuthLayout } from '@/components/auth-layout';
import { Spinner } from '@/components/ui';

function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'verifying' | 'verified' | 'failed'>('verifying');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('failed');
      setMessage('This verification link is missing its token.');
      return;
    }
    let cancelled = false;
    api
      .post<{ message: string }>('/auth/email/verify', { token })
      .then((result) => {
        if (cancelled) return;
        setState('verified');
        setMessage(result.message);
      })
      .catch((error) => {
        if (cancelled) return;
        setState('failed');
        setMessage(error instanceof ApiError ? error.message : 'The link could not be verified.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthLayout
      title="Email verification"
      subtitle="Confirming the address on your KampalaSmart account."
      footer={<Link href="/dashboard" className="font-semibold text-brand-700">Go to workspace</Link>}
    >
      {state === 'verifying' ? (
        <div className="flex items-center gap-2 text-sm text-ink-600">
          <Spinner /> Verifying your link…
        </div>
      ) : state === 'verified' ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 text-sm text-brand-900">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-5 w-5 text-brand-600" /> Email verified
          </p>
          <p className="mt-1 text-brand-800">{message}</p>
          <Link href="/dashboard" className="btn-primary mt-4">
            Continue to dashboard
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <p className="flex items-center gap-2 font-semibold">
            <XCircle className="h-5 w-5" /> Could not verify
          </p>
          <p className="mt-1">{message}</p>
          <p className="mt-3 text-red-700">
            Sign in and use Account → Security to request a fresh verification link.
          </p>
        </div>
      )}
    </AuthLayout>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><Spinner /></div>}>
      <VerifyEmail />
    </Suspense>
  );
}
