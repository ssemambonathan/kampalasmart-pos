'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Eye, EyeOff, Loader2 } from 'lucide-react';
import { CURRENCIES, registerBusinessSchema } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { AuthLayout } from '@/components/auth-layout';
import { Spinner } from '@/components/ui';

const CURRENCY_NAMES: Record<string, string> = {
  UGX: 'Ugandan shilling',
  KES: 'Kenyan shilling',
  TZS: 'Tanzanian shilling',
  USD: 'US dollar',
  EUR: 'Euro',
  GBP: 'Pound sterling',
  ZAR: 'South African rand',
  NGN: 'Nigerian naira',
  GHS: 'Ghanaian cedi',
  RWF: 'Rwandan franc',
};

export default function RegisterPage() {
  const { user, loading, register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    businessName: '',
    ownerName: '',
    email: '',
    phone: '',
    currency: 'UGX',
    password: '',
    confirm: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [loading, user, router]);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const passwordChecks = [
    { label: 'At least 10 characters', ok: form.password.length >= 10 },
    { label: 'One uppercase letter', ok: /[A-Z]/.test(form.password) },
    { label: 'One lowercase letter', ok: /[a-z]/.test(form.password) },
    { label: 'One number', ok: /[0-9]/.test(form.password) },
  ];

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const nextErrors: Record<string, string> = {};
    if (!form.businessName.trim()) nextErrors.businessName = 'Business name is required.';
    if (!form.ownerName.trim()) nextErrors.ownerName = 'Your name is required.';
    const parsed = registerBusinessSchema.safeParse({
      businessName: form.businessName,
      ownerName: form.ownerName,
      email: form.email,
      password: form.password,
      phone: form.phone,
      currency: form.currency,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]?.toString() ?? 'form';
        nextErrors[field] = issue.message;
      }
    }
    if (form.password !== form.confirm) nextErrors.confirm = 'Passwords do not match.';
    if (!accepted) nextErrors.accepted = 'Confirm that you are authorised to create this workspace.';
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    try {
      await register({
        businessName: form.businessName.trim(),
        ownerName: form.ownerName.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim() || undefined,
        currency: form.currency,
      });
      router.replace('/dashboard');
    } catch (registerError) {
      setError(registerError instanceof ApiError ? registerError.message : 'Could not create the workspace. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      wide
      title="Create your workspace"
      subtitle="Your business, first branch and owner account are created together. You can add products and staff next."
      footer={
        <>
          Already trading with us?{' '}
          <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-800">
            Sign in
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

          <div className="field-row">
            <div>
              <label htmlFor="businessName" className="label">
                Business name *
              </label>
              <input
                id="businessName"
                className="input"
                placeholder="Mirembe Mini Market"
                autoComplete="organization"
                value={form.businessName}
                onChange={update('businessName')}
              />
              {errors.businessName ? <p className="error-text">{errors.businessName}</p> : null}
            </div>
            <div>
              <label htmlFor="ownerName" className="label">
                Your full name *
              </label>
              <input
                id="ownerName"
                className="input"
                placeholder="Sarah Namusoke"
                autoComplete="name"
                value={form.ownerName}
                onChange={update('ownerName')}
              />
              {errors.ownerName ? <p className="error-text">{errors.ownerName}</p> : null}
            </div>
          </div>

          <div className="field-row">
            <div>
              <label htmlFor="email" className="label">
                Work email *
              </label>
              <input
                id="email"
                type="email"
                className="input"
                placeholder="you@shop.co.ug"
                autoComplete="email"
                value={form.email}
                onChange={update('email')}
              />
              {errors.email ? <p className="error-text">{errors.email}</p> : null}
            </div>
            <div>
              <label htmlFor="phone" className="label">
                Phone
              </label>
              <input
                id="phone"
                className="input"
                placeholder="+256 700 000 000"
                autoComplete="tel"
                value={form.phone}
                onChange={update('phone')}
              />
            </div>
          </div>

          <div>
            <label htmlFor="currency" className="label">
              Trading currency
            </label>
            <select id="currency" className="select" value={form.currency} onChange={update('currency')}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code} — {CURRENCY_NAMES[code] ?? code}
                </option>
              ))}
            </select>
            <p className="hint">Currency is fixed once you start recording sales, so pick carefully.</p>
          </div>

          <div className="field-row">
            <div>
              <label htmlFor="password" className="label">
                Password *
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="Create a strong password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={update('password')}
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
            <div>
              <label htmlFor="confirm" className="label">
                Confirm password *
              </label>
              <input
                id="confirm"
                type={showPassword ? 'text' : 'password'}
                className="input"
                placeholder="Repeat password"
                autoComplete="new-password"
                value={form.confirm}
                onChange={update('confirm')}
              />
              {errors.confirm ? <p className="error-text">{errors.confirm}</p> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {passwordChecks.map((check) => (
              <span
                key={check.label}
                className={`flex items-center gap-1.5 text-[11px] ${check.ok ? 'text-brand-700' : 'text-ink-400'}`}
              >
                <Check className={`h-3 w-3 ${check.ok ? 'opacity-100' : 'opacity-30'}`} />
                {check.label}
              </span>
            ))}
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
              checked={accepted}
              onChange={(event) => {
                setAccepted(event.target.checked);
                setErrors((current) => ({ ...current, accepted: '' }));
              }}
            />
            <span>
              I am authorised to create this business workspace and accept responsibility for the data
              entered by its users.
            </span>
          </label>
          {errors.accepted ? <p className="error-text">{errors.accepted}</p> : null}

          <button type="submit" className="btn-primary w-full py-2.5" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? 'Creating workspace…' : 'Create workspace'}
          </button>
          <p className="text-center text-[11px] text-ink-400">
            Starts on the 30-day Starter trial. No card required, and no payment is processed here.
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
