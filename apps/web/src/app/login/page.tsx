'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { AuthLayout } from '@/components/auth-layout';
import { Spinner } from '@/components/ui';

function LoginForm() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextParam = searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : null;

  useEffect(() => {
    if (!loading && user) router.replace(next ?? '/dashboard');
  }, [loading, user, next, router]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password, remember);
      router.replace(next ?? '/dashboard');
    } catch (loginError) {
      if (loginError instanceof ApiError) {
        if (loginError.code === 'ACCOUNT_LOCKED') {
          const retry = (loginError.details as { retryAfter?: number } | undefined)?.retryAfter;
          setError(
            retry
              ? `${loginError.message} (${Math.ceil(retry / 60)} minutes remaining)`
              : loginError.message,
          );
        } else {
          setError(loginError.message);
        }
      } else {
        setError('Could not sign in. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your branch workspace to start trading."
      footer={
        <>
          Trouble signing in?{' '}
          <Link href="/forgot-password" className="font-semibold text-brand-700 hover:text-brand-800">
            Reset your password
          </Link>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Spinner /> Checking your session…
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div>
            <label htmlFor="email" className="label">
              Email address
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                className="input pl-9"
                placeholder="you@shop.co.ug"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="label">
                Password
              </label>
              <Link href="/forgot-password" className="mb-1.5 text-[11px] font-semibold text-brand-700 hover:text-brand-800">
                Forgot?
              </Link>
            </div>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                className="input pl-9 pr-10"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            Keep me signed in on this device
          </label>

          <button type="submit" className="btn-primary w-full py-2.5" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-center text-xs text-ink-500">
            Don&apos;t have a workspace?{' '}
            <Link href="/register" className="font-semibold text-brand-700 hover:text-brand-800">
              Create one free
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center text-sm text-ink-500">
          <Spinner />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
