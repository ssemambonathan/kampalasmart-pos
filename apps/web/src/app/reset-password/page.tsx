'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { AuthLayout } from '@/components/auth-layout';
import { Spinner } from '@/components/ui';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const checks = [
    { label: 'At least 10 characters', ok: password.length >= 10 },
    { label: 'One uppercase letter', ok: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', ok: /[a-z]/.test(password) },
    { label: 'One number', ok: /[0-9]/.test(password) },
  ];

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!checks.every((check) => check.ok)) {
      setError('Choose a password that meets all the requirements.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/password/reset', { token, password });
      setDone(true);
      window.setTimeout(() => router.replace('/login'), 1600);
    } catch (resetError) {
      setError(resetError instanceof ApiError ? resetError.message : 'Could not reset the password.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Reset link incomplete" subtitle="This reset link is missing its security token.">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Request a new link from the{' '}
          <Link href="/forgot-password" className="font-semibold underline">
            forgot password
          </Link>{' '}
          page.
        </div>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Password updated" subtitle="You can now sign in with your new password.">
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 text-sm text-brand-900">
          <p className="flex items-center gap-2 font-semibold">
            <Check className="h-4 w-4" /> All existing sessions were revoked
          </p>
          <p className="mt-1 text-brand-800">Redirecting you to sign in…</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Use a password you have not used on this account before.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        <div>
          <label htmlFor="password" className="label">
            New password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="confirm" className="label">
            Confirm new password
          </label>
          <input
            id="confirm"
            type="password"
            className="input"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {checks.map((check) => (
            <span key={check.label} className={`flex items-center gap-1.5 text-[11px] ${check.ok ? 'text-brand-700' : 'text-ink-400'}`}>
              <Check className={`h-3 w-3 ${check.ok ? 'opacity-100' : 'opacity-30'}`} /> {check.label}
            </span>
          ))}
        </div>
        <button type="submit" className="btn-primary w-full py-2.5" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><Spinner /></div>}>
      <ResetForm />
    </Suspense>
  );
}
