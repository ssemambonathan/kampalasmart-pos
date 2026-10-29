'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock,
  KeyRound,
  Laptop,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, relativeTime, titleCase } from '@/lib/format';
import { useToast } from '@/components/toast';
import {
  ErrorState,
  Field,
  PageHeader,
  Spinner,
  cn,
} from '@/components/ui';

interface MySession {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

function validPassword(value: string): boolean {
  return value.length >= 10 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value);
}

function deviceLabel(userAgent: string | null): { label: string; mobile: boolean } {
  if (!userAgent) return { label: 'Unknown device', mobile: false };
  const mobile = /Mobi|Android|iPhone|iPad/i.test(userAgent);
  if (/Edg\//.test(userAgent)) return { label: 'Microsoft Edge', mobile };
  if (/Chrome\//.test(userAgent)) return { label: 'Chrome', mobile };
  if (/Firefox\//.test(userAgent)) return { label: 'Firefox', mobile };
  if (/Safari\//.test(userAgent)) return { label: 'Safari', mobile };
  return { label: userAgent.slice(0, 40), mobile };
}

export default function AccountPage() {
  const { user, business, locations, refresh } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['my-sessions'],
    queryFn: () => api.get<MySession[]>('/auth/sessions'),
  });

  const changePassword = useMutation({
    mutationFn: () =>
      api.patch<{ message: string }>('/auth/password', { currentPassword, newPassword }),
    onSuccess: async (result) => {
      toast(result.message || 'Password updated. Other devices have been signed out.', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError(null);
      await queryClient.invalidateQueries({ queryKey: ['my-sessions'] });
    },
    onError: (error) => setPasswordError(errorMessage(error)),
  });

  const submitPassword = () => {
    setPasswordError(null);
    if (!currentPassword) return setPasswordError('Enter your current password.');
    if (!validPassword(newPassword)) {
      return setPasswordError('Use at least 10 characters with uppercase, lowercase and a number.');
    }
    if (newPassword === currentPassword) return setPasswordError('Choose a password different from your current one.');
    if (newPassword !== confirmPassword) return setPasswordError('The new passwords do not match.');
    changePassword.mutate();
  };

  const requestVerification = useMutation({
    mutationFn: () => api.post<{ message: string }>('/auth/email/verification'),
    onSuccess: (result) => {
      setVerificationMessage(result.message);
      setVerificationError(null);
    },
    onError: (error) => setVerificationError(errorMessage(error)),
  });

  const verifyToken = useMutation({
    mutationFn: () => api.post<{ message: string }>('/auth/email/verify', { token: token.trim() }),
    onSuccess: async (result) => {
      toast(result.message, 'success');
      setToken('');
      setTokenOpen(false);
      setVerificationMessage(result.message);
      setVerificationError(null);
      await refresh();
    },
    onError: (error) => setTokenError(errorMessage(error)),
  });

  const revoke = useMutation({
    mutationFn: (sessionId: string) => api.delete<{ message: string }>(`/auth/sessions/${sessionId}`),
    onSuccess: async (result) => {
      toast(result.message || 'Session revoked.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['my-sessions'] });
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const assignedLocations = locations.filter((location) => user?.locationIds.includes(location.id));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Account"
        title="Account & security"
        description="Your identity, password and the devices signed in to this account."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-4">
          <div className="card card-pad">
            <div className="flex items-center gap-3">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-700 text-lg font-bold text-white">
                {user?.name
                  .split(' ')
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-ink-950">{user?.name}</h2>
                <p className="truncate text-xs text-ink-500">{user?.email}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className="badge-blue">{user ? titleCase(user.role) : ''}</span>
                  {user?.emailVerified ? (
                    <span className="badge-green inline-flex items-center gap-1">
                      <BadgeCheck className="h-3 w-3" /> Verified
                    </span>
                  ) : (
                    <span className="badge-amber">Email unverified</span>
                  )}
                </div>
              </div>
            </div>

            <dl className="mt-4 divide-y divide-ink-100 text-xs">
              <div className="flex items-center justify-between gap-3 py-2">
                <dt className="flex items-center gap-1.5 text-ink-500">
                  <Building2 className="h-3.5 w-3.5" /> Business
                </dt>
                <dd className="font-medium text-ink-800">{business?.name}</dd>
              </div>
              <div className="flex items-start justify-between gap-3 py-2">
                <dt className="flex items-center gap-1.5 text-ink-500">
                  <Lock className="h-3.5 w-3.5" /> Branches
                </dt>
                <dd className="text-right font-medium text-ink-800">
                  {assignedLocations.length ? assignedLocations.map((location) => location.name).join(', ') : 'All branches'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <dt className="text-ink-500">Permissions</dt>
                <dd className="font-mono font-medium text-ink-800">{user?.permissions.length ?? 0} granted by role</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
              Name, role and branch assignments are managed by the business owner under Settings → Team. They
              cannot be changed from this page.
            </p>
          </div>

          <div className="card card-pad">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-ink-500" />
                <h2 className="text-sm font-semibold text-ink-900">Email verification</h2>
              </div>
              {user?.emailVerified ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : null}
            </div>
            {user?.emailVerified ? (
              <p className="mt-2 text-xs text-ink-600">
                This address is verified. Verification links are single use and expire automatically.
              </p>
            ) : (
              <>
                <p className="mt-2 text-xs leading-relaxed text-ink-600">
                  Your email has not been verified. Verification is not required to trade, but it protects account
                  recovery.
                </p>
                {verificationMessage ? (
                  <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[11px] leading-relaxed text-brand-900">
                    {verificationMessage}
                  </div>
                ) : null}
                {verificationError ? (
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
                    {verificationError}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => requestVerification.mutate()}
                    disabled={requestVerification.isPending}
                  >
                    {requestVerification.isPending ? <Spinner /> : <Mail className="h-3.5 w-3.5" />}
                    Send verification link
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setTokenOpen((open) => !open)}>
                    I have a token
                  </button>
                </div>
                {tokenOpen ? (
                  <div className="mt-3 space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-3">
                    <Field label="Verification token" htmlFor="email-token" error={tokenError ?? undefined}>
                      <input
                        id="email-token"
                        className="input font-mono text-xs"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        placeholder="Paste the token from the verification link"
                        maxLength={300}
                      />
                    </Field>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => {
                        setTokenError(null);
                        if (token.trim().length < 20) {
                          setTokenError('That token looks too short. Paste the complete value.');
                          return;
                        }
                        verifyToken.mutate();
                      }}
                      disabled={verifyToken.isPending}
                    >
                      {verifyToken.isPending ? <Spinner /> : <ShieldCheck className="h-3.5 w-3.5" />} Verify email
                    </button>
                  </div>
                ) : null}
                <p className="mt-2 text-[10px] leading-relaxed text-ink-400">
                  This deployment uses a development email outbox. If no email arrives, the verification token is
                  written to the API logs; configure an email provider for production delivery.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3">
              <KeyRound className="h-4 w-4 text-ink-500" />
              <div>
                <h2 className="text-sm font-semibold text-ink-900">Change password</h2>
                <p className="text-xs text-ink-500">Other devices are signed out when the password changes.</p>
              </div>
            </div>
            <form
              className="space-y-3 px-4 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                submitPassword();
              }}
            >
              {passwordError ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {passwordError}
                </div>
              ) : null}
              <Field label="Current password" htmlFor="current-password" required>
                <input
                  id="current-password"
                  type="password"
                  className="input"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  maxLength={200}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="New password" htmlFor="new-password" required hint="10+ characters, upper and lower case, a number.">
                  <input
                    id="new-password"
                    type="password"
                    className="input"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    maxLength={200}
                  />
                </Field>
                <Field label="Confirm new password" htmlFor="confirm-password" required>
                  <input
                    id="confirm-password"
                    type="password"
                    className="input"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    maxLength={200}
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={changePassword.isPending || !currentPassword || !newPassword || !confirmPassword}
                >
                  {changePassword.isPending ? <Spinner /> : <KeyRound className="h-4 w-4" />} Update password
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <Laptop className="h-4 w-4 text-ink-500" />
                <div>
                  <h2 className="text-sm font-semibold text-ink-900">Signed-in devices</h2>
                  <p className="text-xs text-ink-500">Revoke anything you do not recognise.</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => void sessions.refetch()}
                disabled={sessions.isFetching}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', sessions.isFetching && 'animate-spin')} /> Refresh
              </button>
            </div>
            {sessions.isLoading ? (
              <div className="space-y-2 px-4 py-4">
                <div className="skeleton h-4 w-2/3" />
                <div className="skeleton h-4 w-1/2" />
              </div>
            ) : sessions.isError ? (
              <ErrorState message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
            ) : !sessions.data?.length ? (
              <p className="px-4 py-6 text-xs text-ink-500">No active sessions were returned.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {sessions.data.map((session) => {
                  const device = deviceLabel(session.userAgent);
                  return (
                    <li key={session.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-500">
                        {device.mobile ? <Smartphone className="h-4 w-4" /> : <Laptop className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-xs font-semibold text-ink-800">{device.label}</p>
                          {session.current ? <span className="badge-green">This device</span> : null}
                        </div>
                        <p className="truncate text-[11px] text-ink-500">
                          {session.ip ?? 'IP not recorded'} · started {formatDate(session.createdAt, true)}
                        </p>
                        <p className="text-[11px] text-ink-400">
                          Last used {relativeTime(session.lastUsedAt)} · expires {formatDate(session.expiresAt)}
                        </p>
                      </div>
                      {session.current ? (
                        <span className="text-[11px] text-ink-400">Current</span>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost btn-sm shrink-0 text-red-600 hover:bg-red-50"
                          onClick={() => revoke.mutate(session.id)}
                          disabled={revoke.isPending}
                        >
                          Revoke
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="border-t border-ink-100 px-4 py-2.5">
              <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-400">
                <Clock className="mt-0.5 h-3 w-3 shrink-0" />
                Sessions expire automatically. Revoking a session signs that device out on its next request.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-ink-500">
            <div className="flex items-center gap-1.5 font-semibold text-ink-700">
              <ShieldCheck className="h-3.5 w-3.5" /> Security activity is auditable
            </div>
            <p className="mt-1">
              Sign-ins, password changes, session revocations and email verification are written to the business audit
              trail with the device and IP address.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
