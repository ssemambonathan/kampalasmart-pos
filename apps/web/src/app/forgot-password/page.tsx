'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, MailCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { AuthLayout } from '@/components/auth-layout';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<{ message: string }>('/auth/password/forgot', { email });
      setMessage(result.message);
    } catch (resetError) {
      setError(resetError instanceof ApiError ? resetError.message : 'Could not send the reset request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email on your account and we will create a one-time reset link."
      footer={
        <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-800">
          Back to sign in
        </Link>
      }
    >
      {message ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 text-sm text-brand-900" role="status">
          <MailCheck className="mb-2 h-5 w-5 text-brand-700" />
          <p className="font-semibold">Request received</p>
          <p className="mt-1 text-brand-800">
            {message} In this deployment, transactional email is captured by the configured development
            mail transport rather than delivered to an external inbox.
          </p>
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
            <input
              id="email"
              type="email"
              required
              className="input"
              autoComplete="email"
              placeholder="you@shop.co.ug"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary w-full py-2.5" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
