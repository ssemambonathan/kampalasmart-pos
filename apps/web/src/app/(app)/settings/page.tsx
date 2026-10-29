'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  KeyRound,
  Lock,
  MapPin,
  Pencil,
  Percent,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Store,
  Unlock,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import type {
  BusinessPlan,
  BusinessSettings,
  Location,
  Paginated,
  SubscriptionStatus,
  TaxRate,
  UserRole,
} from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatNumber, relativeTime, titleCase } from '@/lib/format';
import { useToast } from '@/components/toast';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Spinner,
  StatusBadge,
  TableSkeleton,
  Tabs,
  Toggle,
  cn,
  useDebounced,
} from '@/components/ui';

type SettingsTab = 'business' | 'tax' | 'branches' | 'team' | 'subscription';

const TIMEZONES = [
  'Africa/Kampala',
  'Africa/Nairobi',
  'Africa/Dar_es_Salaam',
  'Africa/Kigali',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'UTC',
];

const CURRENCIES = ['UGX', 'KES', 'TZS', 'RWF', 'NGN', 'GHS', 'ZAR', 'USD', 'EUR', 'GBP'];

const LOCALES = ['en-UG', 'en-KE', 'en-TZ', 'en-NG', 'en-ZA', 'en-GB'];

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
  INVENTORY_CLERK: 'Inventory clerk',
};

const ROLE_NOTES: Record<UserRole, string> = {
  OWNER: 'Full access, including settings, billing and team management.',
  MANAGER: 'Runs branches, stock, purchases and reports. Cannot change business settings or manage users.',
  CASHIER: 'Sells, takes payments and requests refunds. Sees only their own sales.',
  INVENTORY_CLERK: 'Receives stock, purchases, transfers and stock counts. No sales or financial reports.',
};

const FEATURE_LABELS: Array<{ key: keyof PlanFeatures; label: string }> = [
  { key: 'multiLocation', label: 'Multiple branches' },
  { key: 'analytics', label: 'Profit analytics' },
  { key: 'advancedReports', label: 'Advanced reports' },
  { key: 'auditExport', label: 'Audit log export' },
  { key: 'assistant', label: 'Business assistant' },
];

interface PlanFeatures {
  multiLocation: boolean;
  analytics: boolean;
  assistant: boolean;
  auditExport: boolean;
  advancedReports: boolean;
}

interface PlanView {
  id: BusinessPlan;
  name: string;
  description: string;
  maxUsers: number | null;
  maxLocations: number | null;
  features: PlanFeatures;
}

interface SettingsResponse {
  business: BusinessSettings;
  taxRates: TaxRate[];
  usage: {
    activeUsers: number;
    totalUsers: number;
    locations: number;
    products: number;
    customers: number;
    suppliers: number;
    plan: { id: BusinessPlan; name: string; maxUsers: number | null; maxLocations: number | null; features: PlanFeatures };
  };
  subscription: {
    plan: BusinessPlan;
    status: SubscriptionStatus;
    active: boolean;
    trialEndsAt: string | null;
    trialDaysRemaining: number | null;
  };
}

interface PlansResponse {
  current: { plan: BusinessPlan; status: SubscriptionStatus; trialEndsAt: string | null };
  plans: PlanView[];
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'ACTIVE' | 'SUSPENDED';
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  locationIds: string[];
  locations: Array<{ id: string; name: string; code: string }>;
}

interface MemberSession {
  id: string;
  ip: string | null;
  userAgent: string | null;
  rememberMe: boolean;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
}

interface BusinessForm {
  name: string;
  phone: string;
  email: string;
  address: string;
  logoUrl: string;
  currency: string;
  timezone: string;
  locale: string;
  receiptFooter: string;
  taxEnabled: boolean;
  taxInclusive: boolean;
  taxRate: string;
  allowNegativeStock: boolean;
  maxCashierDiscountPercent: string;
  maxManagerDiscountPercent: string;
  refundApprovalThreshold: string;
  defaultLeadTimeDays: string;
}

interface TaxForm {
  id?: string;
  name: string;
  rate: string;
  isInclusive: boolean;
  isDefault: boolean;
}

interface BranchForm {
  id?: string;
  name: string;
  code: string;
  address: string;
  phone: string;
}

interface TeamForm {
  name: string;
  email: string;
  role: UserRole;
  password: string;
  locationIds: string[];
}

interface MemberForm {
  id: string;
  name: string;
  role: UserRole;
  status: 'ACTIVE' | 'SUSPENDED';
  locationIds: string[];
}

function businessToForm(business: BusinessSettings): BusinessForm {
  return {
    name: business.name,
    phone: business.phone ?? '',
    email: business.email ?? '',
    address: business.address ?? '',
    logoUrl: business.logoUrl ?? '',
    currency: business.currency,
    timezone: business.timezone,
    locale: business.locale,
    receiptFooter: business.receiptFooter ?? '',
    taxEnabled: business.taxEnabled,
    taxInclusive: business.taxInclusive,
    taxRate: business.taxRate,
    allowNegativeStock: business.allowNegativeStock,
    maxCashierDiscountPercent: business.maxCashierDiscountPercent,
    maxManagerDiscountPercent: business.maxManagerDiscountPercent,
    refundApprovalThreshold: business.refundApprovalThreshold,
    defaultLeadTimeDays: String(business.defaultLeadTimeDays),
  };
}

function numberInRange(value: string, min: number, max: number): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
}

function memberIsLocked(member: TeamMember): boolean {
  return Boolean(member.lockedUntil && new Date(member.lockedUntil).getTime() > Date.now());
}

function planLimit(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unlimited';
  return formatNumber(value);
}

function Meter({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  const unlimited = limit === null || !Number.isFinite(limit);
  const percent = unlimited ? 18 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const pressure = !unlimited && used >= limit;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-ink-700">{label}</span>
        <span className={cn('font-mono', pressure ? 'text-red-600' : 'text-ink-500')}>
          {formatNumber(used)} / {planLimit(limit)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className={cn('h-full rounded-full', pressure ? 'bg-red-500' : percent > 80 ? 'bg-accent-500' : 'bg-brand-600')}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function BranchChecks({
  locations,
  selected,
  onChange,
  disabled,
}: {
  locations: Location[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  if (!locations.length) {
    return <p className="text-xs text-ink-500">No active branches are available to assign.</p>;
  }
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {locations.map((location) => {
        const checked = selected.includes(location.id);
        return (
          <label
            key={location.id}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs',
              checked ? 'border-brand-300 bg-brand-50' : 'border-ink-200 bg-white',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand-700"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(checked ? selected.filter((id) => id !== location.id) : [...selected, location.id])}
            />
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink-800">{location.name}</span>
              <span className="block font-mono text-[10px] text-ink-400">{location.code}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export default function SettingsPage() {
  const { user, can, refresh } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SettingsTab>('business');
  const canManageSettings = can('settings:manage');
  const canManageBranches = can('locations:manage');
  const canManageUsers = can('users:manage');
  const canReadUsers = can('users:read');

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsResponse>('/settings'),
    enabled: can('settings:read'),
  });
  const currency = settings.data?.business.currency ?? 'UGX';

  const plans = useQuery({
    queryKey: ['settings-plans'],
    queryFn: () => api.get<PlansResponse>('/settings/plans'),
    enabled: tab === 'subscription' && can('business:read'),
  });

  const branches = useQuery({
    queryKey: ['settings-branches'],
    queryFn: () => api.get<Location[]>('/locations', { includeInactive: true }),
    enabled: (tab === 'branches' || tab === 'team') && can('locations:read'),
  });

  const [teamPage, setTeamPage] = useState(1);
  const [teamSearch, setTeamSearch] = useState('');
  const [teamRole, setTeamRole] = useState<'' | UserRole>('');
  const [teamStatus, setTeamStatus] = useState<'' | 'ACTIVE' | 'SUSPENDED'>('');
  const debouncedTeamSearch = useDebounced(teamSearch, 300);

  const team = useQuery({
    queryKey: ['team', teamPage, debouncedTeamSearch, teamRole, teamStatus],
    queryFn: () =>
      api.get<Paginated<TeamMember>>('/users', {
        page: teamPage,
        pageSize: 10,
        search: debouncedTeamSearch || undefined,
        role: teamRole || undefined,
        status: teamStatus || undefined,
        includeInactive: true,
      }),
    enabled: tab === 'team' && canReadUsers,
  });

  const [businessForm, setBusinessForm] = useState<BusinessForm | null>(null);
  const [businessError, setBusinessError] = useState<string | null>(null);
  const [taxForm, setTaxForm] = useState<TaxForm | null>(null);
  const [taxError, setTaxError] = useState<string | null>(null);
  const [archiveTax, setArchiveTax] = useState<TaxRate | null>(null);
  const [branchForm, setBranchForm] = useState<BranchForm | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [toggleBranch, setToggleBranch] = useState<Location | null>(null);
  const [invite, setInvite] = useState<TeamForm | null>(null);
  const [memberForm, setMemberForm] = useState<MemberForm | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<TeamMember | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [archiveMember, setArchiveMember] = useState<TeamMember | null>(null);
  const [sessionsTarget, setSessionsTarget] = useState<TeamMember | null>(null);

  useEffect(() => {
    if (settings.data) setBusinessForm(businessToForm(settings.data.business));
  }, [settings.data]);

  const sessions = useQuery({
    queryKey: ['member-sessions', sessionsTarget?.id],
    queryFn: () => api.get<{ data: MemberSession[] }>(`/users/${sessionsTarget!.id}/sessions`),
    enabled: Boolean(sessionsTarget) && canManageUsers,
  });

  const baseline = settings.data ? businessToForm(settings.data.business) : null;
  const dirty = Boolean(businessForm && baseline && JSON.stringify(businessForm) !== JSON.stringify(baseline));

  const saveBusiness = useMutation({
    mutationFn: (form: BusinessForm) =>
      api.patch<BusinessSettings>('/settings/business', {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
        currency: form.currency,
        timezone: form.timezone,
        locale: form.locale,
        receiptFooter: form.receiptFooter.trim() || null,
        taxEnabled: form.taxEnabled,
        taxInclusive: form.taxInclusive,
        taxRate: Number(form.taxRate).toFixed(3),
        allowNegativeStock: form.allowNegativeStock,
        maxCashierDiscountPercent: Number(form.maxCashierDiscountPercent).toFixed(2),
        maxManagerDiscountPercent: Number(form.maxManagerDiscountPercent).toFixed(2),
        refundApprovalThreshold: Number(form.refundApprovalThreshold).toFixed(2),
        defaultLeadTimeDays: Number(form.defaultLeadTimeDays),
      }),
    onSuccess: async () => {
      toast('Business settings saved. Changes are recorded in the audit trail.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await refresh();
    },
    onError: (error) => setBusinessError(errorMessage(error)),
  });

  const submitBusiness = () => {
    if (!businessForm) return;
    setBusinessError(null);
    if (businessForm.name.trim().length < 2) return setBusinessError('Business name must be at least 2 characters.');
    if (businessForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessForm.email.trim())) {
      return setBusinessError('Enter a valid business email address, or leave it blank.');
    }
    if (!numberInRange(businessForm.taxRate, 0, 100)) return setBusinessError('Tax rate must be between 0 and 100.');
    if (!numberInRange(businessForm.maxCashierDiscountPercent, 0, 100)) {
      return setBusinessError('Cashier discount limit must be between 0 and 100.');
    }
    if (!numberInRange(businessForm.maxManagerDiscountPercent, 0, 100)) {
      return setBusinessError('Manager discount limit must be between 0 and 100.');
    }
    if (Number(businessForm.maxCashierDiscountPercent) > Number(businessForm.maxManagerDiscountPercent)) {
      return setBusinessError('The cashier discount limit cannot exceed the manager limit.');
    }
    if (!numberInRange(businessForm.refundApprovalThreshold, 0, 1_000_000_000)) {
      return setBusinessError('Refund approval threshold must be a non-negative amount.');
    }
    if (!Number.isInteger(Number(businessForm.defaultLeadTimeDays)) || !numberInRange(businessForm.defaultLeadTimeDays, 0, 365)) {
      return setBusinessError('Default lead time must be a whole number of days between 0 and 365.');
    }
    saveBusiness.mutate(businessForm);
  };

  const saveTax = useMutation({
    mutationFn: (form: TaxForm) =>
      form.id
        ? api.patch<TaxRate>(`/settings/tax-rates/${form.id}`, {
            name: form.name.trim(),
            rate: Number(form.rate).toFixed(3),
            isInclusive: form.isInclusive,
            isDefault: form.isDefault,
          })
        : api.post<TaxRate>('/settings/tax-rates', {
            name: form.name.trim(),
            rate: Number(form.rate).toFixed(3),
            isInclusive: form.isInclusive,
            isDefault: form.isDefault,
          }),
    onSuccess: async () => {
      toast('Tax rate saved.', 'success');
      setTaxForm(null);
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
    },
    onError: (error) => setTaxError(errorMessage(error)),
  });

  const restoreTax = useMutation({
    mutationFn: (rate: TaxRate) => api.patch<TaxRate>(`/settings/tax-rates/${rate.id}`, { isActive: true }),
    onSuccess: async () => {
      toast('Tax rate restored.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const archiveTaxRate = useMutation({
    mutationFn: (rate: TaxRate) => api.delete<{ success: boolean }>(`/settings/tax-rates/${rate.id}`),
    onSuccess: async () => {
      toast('Tax rate archived. Historical sales keep the rate they were recorded with.', 'success');
      setArchiveTax(null);
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const submitTax = () => {
    if (!taxForm) return;
    setTaxError(null);
    if (!taxForm.name.trim()) return setTaxError('Give the tax rate a name, for example VAT 18%.');
    if (!numberInRange(taxForm.rate, 0, 100)) return setTaxError('Rate must be between 0 and 100.');
    saveTax.mutate(taxForm);
  };

  const saveBranch = useMutation({
    mutationFn: (form: BranchForm) =>
      form.id
        ? api.patch<Location>(`/locations/${form.id}`, {
            name: form.name.trim(),
            code: form.code.trim().toUpperCase(),
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
          })
        : api.post<Location>('/locations', {
            name: form.name.trim(),
            code: form.code.trim().toUpperCase(),
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
          }),
    onSuccess: async () => {
      toast('Branch saved.', 'success');
      setBranchForm(null);
      await queryClient.invalidateQueries({ queryKey: ['settings-branches'] });
      await queryClient.invalidateQueries({ queryKey: ['locations'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await refresh();
    },
    onError: (error) => setBranchError(errorMessage(error)),
  });

  const changeBranchState = useMutation({
    mutationFn: (location: Location) =>
      api.patch<Location>(`/locations/${location.id}`, { isActive: !location.isActive }),
    onSuccess: async () => {
      toast('Branch updated. No historical records were removed.', 'success');
      setToggleBranch(null);
      await queryClient.invalidateQueries({ queryKey: ['settings-branches'] });
      await queryClient.invalidateQueries({ queryKey: ['locations'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await refresh();
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const submitBranch = () => {
    if (!branchForm) return;
    setBranchError(null);
    if (!branchForm.name.trim()) return setBranchError('Branch name is required.');
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(branchForm.code.trim())) {
      return setBranchError('Code must be 1–16 letters, numbers, dashes or underscores.');
    }
    saveBranch.mutate(branchForm);
  };

  const createMember = useMutation({
    mutationFn: (form: TeamForm) =>
      api.post<TeamMember>('/users', {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role,
        password: form.password,
        locationIds: form.locationIds,
      }),
    onSuccess: async () => {
      toast('Team member created. Share the temporary password through a secure channel.', 'success');
      setInvite(null);
      await queryClient.invalidateQueries({ queryKey: ['team'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error) => setTeamError(errorMessage(error)),
  });

  const updateMember = useMutation({
    mutationFn: (form: MemberForm) =>
      api.patch<TeamMember>(`/users/${form.id}`, {
        name: form.name.trim(),
        role: form.role,
        status: form.status,
        locationIds: form.locationIds,
      }),
    onSuccess: async () => {
      toast('Team member updated.', 'success');
      setMemberForm(null);
      await queryClient.invalidateQueries({ queryKey: ['team'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error) => setTeamError(errorMessage(error)),
  });

  const resetMemberPassword = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>(`/users/${resetTarget!.id}/reset-password`, { password: resetPassword }),
    onSuccess: async (result) => {
      toast(result.message || 'Password reset. Active sessions were revoked.', 'success');
      setResetTarget(null);
      setResetPassword('');
      await queryClient.invalidateQueries({ queryKey: ['team'] });
    },
    onError: (error) => setTeamError(errorMessage(error)),
  });

  const unlockMember = useMutation({
    mutationFn: (member: TeamMember) => api.post<TeamMember>(`/users/${member.id}/unlock`),
    onSuccess: async () => {
      toast('Sign-in lockout cleared.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['team'] });
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const archiveTeamMember = useMutation({
    mutationFn: (member: TeamMember) => api.delete<TeamMember>(`/users/${member.id}`),
    onSuccess: async () => {
      toast('Team member deactivated. Their historical sales and audit entries remain.', 'success');
      setArchiveMember(null);
      await queryClient.invalidateQueries({ queryKey: ['team'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const revokeMemberSessions = useMutation({
    mutationFn: ({ member, sessionId }: { member: TeamMember; sessionId?: string }) =>
      api.delete<{ message: string }>(
        `/users/${member.id}/sessions${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`,
      ),
    onSuccess: async () => {
      toast('Session revoked.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['member-sessions', sessionsTarget?.id] });
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const validPassword = (value: string) =>
    value.length >= 10 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value);

  const submitInvite = () => {
    if (!invite) return;
    setTeamError(null);
    if (invite.name.trim().length < 2) return setTeamError('Enter the team member’s full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invite.email.trim())) return setTeamError('Enter a valid email address.');
    if (!validPassword(invite.password)) {
      return setTeamError('Use at least 10 characters with uppercase, lowercase and a number.');
    }
    if (!invite.locationIds.length) return setTeamError('Assign at least one branch.');
    createMember.mutate(invite);
  };

  const submitMember = () => {
    if (!memberForm) return;
    setTeamError(null);
    if (memberForm.name.trim().length < 2) return setTeamError('Enter the team member’s full name.');
    if (!memberForm.locationIds.length) return setTeamError('Assign at least one branch.');
    updateMember.mutate(memberForm);
  };

  const tabs = useMemo<Array<{ id: SettingsTab; label: string; count?: number }>>(
    () => [
      { id: 'business', label: 'Business' },
      { id: 'tax', label: 'Tax rates', count: settings.data?.taxRates.length },
      { id: 'branches', label: 'Branches', count: settings.data?.usage.locations },
      { id: 'team', label: 'Team', count: settings.data?.usage.activeUsers },
      { id: 'subscription', label: 'Plan & usage' },
    ],
    [settings.data],
  );

  if (!can('settings:read')) {
    return (
      <div>
        <PageHeader title="Settings" eyebrow="Operate" />
        <div className="card p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-ink-100 text-ink-500">
            <Lock className="h-5 w-5" />
          </span>
          <h2 className="mt-3 text-base font-semibold text-ink-900">Settings are managed by the owner</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
            Your role does not include access to business configuration, tax rates or team accounts. Ask the owner
            if you need a change.
          </p>
        </div>
      </div>
    );
  }

  if (settings.isLoading) {
    return (
      <div>
        <PageHeader title="Settings" eyebrow="Operate" />
        <div className="card"><TableSkeleton rows={8} cols={3} /></div>
      </div>
    );
  }

  if (settings.isError) {
    return (
      <div>
        <PageHeader title="Settings" eyebrow="Operate" />
        <div className="card">
          <ErrorState message={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />
        </div>
      </div>
    );
  }

  const data = settings.data!;
  const activeLocations = (branches.data ?? []).filter((location) => location.isActive);

  return (
    <div>
      <PageHeader
        eyebrow="Operate"
        title="Settings"
        description="Business profile, money rules, branches, tax and the people who can access this workspace."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-600">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-600" />
            {canManageSettings ? 'You can make changes' : 'Read-only access'}
          </span>
        }
      />

      <div className="card card-pad mb-4">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </div>

      {tab === 'business' ? (
        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <div className="card">
            <div className="border-b border-ink-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-ink-900">Business profile</h2>
              <p className="text-xs text-ink-500">Shown on receipts and used across reports.</p>
            </div>
            {!businessForm ? (
              <TableSkeleton rows={6} cols={2} />
            ) : (
              <div className="space-y-4 px-4 py-4">
                {businessError ? (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {businessError}
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Business name" htmlFor="business-name" required>
                    <input
                      id="business-name"
                      className="input"
                      value={businessForm.name}
                      disabled={!canManageSettings}
                      onChange={(event) => setBusinessForm({ ...businessForm, name: event.target.value })}
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Phone" htmlFor="business-phone">
                    <input
                      id="business-phone"
                      className="input"
                      value={businessForm.phone}
                      disabled={!canManageSettings}
                      onChange={(event) => setBusinessForm({ ...businessForm, phone: event.target.value })}
                      maxLength={30}
                    />
                  </Field>
                  <Field label="Email" htmlFor="business-email">
                    <input
                      id="business-email"
                      type="email"
                      className="input"
                      value={businessForm.email}
                      disabled={!canManageSettings}
                      onChange={(event) => setBusinessForm({ ...businessForm, email: event.target.value })}
                      maxLength={255}
                    />
                  </Field>
                  <Field label="Address" htmlFor="business-address">
                    <input
                      id="business-address"
                      className="input"
                      value={businessForm.address}
                      disabled={!canManageSettings}
                      onChange={(event) => setBusinessForm({ ...businessForm, address: event.target.value })}
                      maxLength={300}
                    />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Currency" htmlFor="business-currency" hint="Locked once the first sale is recorded.">
                    <select
                      id="business-currency"
                      className="select"
                      value={businessForm.currency}
                      disabled={!canManageSettings}
                      onChange={(event) => setBusinessForm({ ...businessForm, currency: event.target.value })}
                    >
                      {CURRENCIES.map((code) => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Time zone" htmlFor="business-timezone">
                    <select
                      id="business-timezone"
                      className="select"
                      value={businessForm.timezone}
                      disabled={!canManageSettings}
                      onChange={(event) => setBusinessForm({ ...businessForm, timezone: event.target.value })}
                    >
                      {TIMEZONES.map((zone) => (
                        <option key={zone} value={zone}>{zone}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Locale" htmlFor="business-locale">
                    <select
                      id="business-locale"
                      className="select"
                      value={businessForm.locale}
                      disabled={!canManageSettings}
                      onChange={(event) => setBusinessForm({ ...businessForm, locale: event.target.value })}
                    >
                      {LOCALES.map((locale) => (
                        <option key={locale} value={locale}>{locale}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="rounded-xl border border-ink-200">
                  <div className="border-b border-ink-100 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Money & stock policy</p>
                  </div>
                  <div className="px-3">
                    <Toggle
                      checked={businessForm.taxEnabled}
                      onChange={(next) => setBusinessForm({ ...businessForm, taxEnabled: next })}
                      label="Charge tax on sales"
                      description="When off, the till applies no tax regardless of product tax rates."
                      disabled={!canManageSettings}
                    />
                    <Toggle
                      checked={businessForm.taxInclusive}
                      onChange={(next) => setBusinessForm({ ...businessForm, taxInclusive: next })}
                      label="Prices include tax"
                      description="Shown prices are tax-inclusive; tax is extracted from the total instead of added."
                      disabled={!canManageSettings || !businessForm.taxEnabled}
                    />
                    <Toggle
                      checked={businessForm.allowNegativeStock}
                      onChange={(next) => setBusinessForm({ ...businessForm, allowNegativeStock: next })}
                      label="Allow selling into negative stock"
                      description="Off by default. When off, sales that exceed recorded stock are rejected as conflicts."
                      disabled={!canManageSettings}
                    />
                    <div className="grid gap-3 border-t border-ink-100 py-3 sm:grid-cols-2">
                      <Field label="Default tax rate (%)" htmlFor="business-tax-rate">
                        <input
                          id="business-tax-rate"
                          type="number"
                          min="0"
                          max="100"
                          step="0.001"
                          className="input"
                          value={businessForm.taxRate}
                          disabled={!canManageSettings}
                          onChange={(event) => setBusinessForm({ ...businessForm, taxRate: event.target.value })}
                        />
                      </Field>
                      <Field label="Refund approval threshold" htmlFor="business-refund-threshold" hint={`In ${currency}. At or above this amount a second person must approve.`}>
                        <input
                          id="business-refund-threshold"
                          type="number"
                          min="0"
                          step="0.01"
                          className="input"
                          value={businessForm.refundApprovalThreshold}
                          disabled={!canManageSettings}
                          onChange={(event) =>
                            setBusinessForm({ ...businessForm, refundApprovalThreshold: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="Cashier discount limit (%)" htmlFor="business-cashier-discount">
                        <input
                          id="business-cashier-discount"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          className="input"
                          value={businessForm.maxCashierDiscountPercent}
                          disabled={!canManageSettings}
                          onChange={(event) =>
                            setBusinessForm({ ...businessForm, maxCashierDiscountPercent: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="Manager discount limit (%)" htmlFor="business-manager-discount">
                        <input
                          id="business-manager-discount"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          className="input"
                          value={businessForm.maxManagerDiscountPercent}
                          disabled={!canManageSettings}
                          onChange={(event) =>
                            setBusinessForm({ ...businessForm, maxManagerDiscountPercent: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="Default lead time (days)" htmlFor="business-lead-time" hint="Used when a product has no supplier lead time of its own.">
                        <input
                          id="business-lead-time"
                          type="number"
                          min="0"
                          max="365"
                          step="1"
                          className="input"
                          value={businessForm.defaultLeadTimeDays}
                          disabled={!canManageSettings}
                          onChange={(event) =>
                            setBusinessForm({ ...businessForm, defaultLeadTimeDays: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="Logo URL" htmlFor="business-logo" hint="Optional https image address for receipts.">
                        <input
                          id="business-logo"
                          className="input"
                          value={businessForm.logoUrl}
                          disabled={!canManageSettings}
                          onChange={(event) => setBusinessForm({ ...businessForm, logoUrl: event.target.value })}
                          maxLength={500}
                        />
                      </Field>
                    </div>
                    <div className="border-t border-ink-100 py-3">
                      <Field label="Receipt footer" htmlFor="business-footer" hint="Printed below the totals, for example a returns policy.">
                        <textarea
                          id="business-footer"
                          className="textarea"
                          rows={2}
                          value={businessForm.receiptFooter}
                          disabled={!canManageSettings}
                          onChange={(event) => setBusinessForm({ ...businessForm, receiptFooter: event.target.value })}
                          maxLength={500}
                        />
                      </Field>
                    </div>
                  </div>
                </div>

                {canManageSettings ? (
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setBusinessForm(baseline);
                        setBusinessError(null);
                      }}
                      disabled={!dirty || saveBusiness.isPending}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={submitBusiness}
                      disabled={!dirty || saveBusiness.isPending}
                    >
                      <RefreshCw className={cn('h-4 w-4', saveBusiness.isPending && 'animate-spin')} />
                      Save changes
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="card card-pad">
              <h2 className="text-sm font-semibold text-ink-900">At a glance</h2>
              <dl className="mt-2 divide-y divide-ink-100 text-xs">
                {[
                  ['Plan', data.usage.plan.name],
                  ['Subscription', titleCase(data.subscription.status)],
                  ['Branches', formatNumber(data.usage.locations)],
                  ['Active users', `${formatNumber(data.usage.activeUsers)} of ${formatNumber(data.usage.totalUsers)}`],
                  ['Products', formatNumber(data.usage.products)],
                  ['Customers', formatNumber(data.usage.customers)],
                  ['Suppliers', formatNumber(data.usage.suppliers)],
                  ['Created', formatDate(data.business.createdAt)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-ink-500">{label}</dt>
                    <dd className="font-medium text-ink-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-3 text-[11px] leading-relaxed text-brand-900">
              <div className="flex items-center gap-1.5 font-semibold">
                <ShieldCheck className="h-3.5 w-3.5" /> Changes are auditable
              </div>
              <p className="mt-1">
                Saving settings writes an audit event with the before and after values. Currency cannot change after
                the first recorded sale, so historical totals stay comparable.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'tax' ? (
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-ink-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">Tax rates</h2>
              <p className="text-xs text-ink-500">
                Rates are assigned per product. Archiving never changes the rate on past sales.
              </p>
            </div>
            {canManageSettings ? (
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => {
                  setTaxError(null);
                  setTaxForm({ name: '', rate: data.business.taxRate, isInclusive: data.business.taxInclusive, isDefault: false });
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add tax rate
              </button>
            ) : null}
          </div>
          {!data.taxRates.length ? (
            <EmptyState
              icon={<Percent className="h-5 w-5" />}
              title="No tax rates yet"
              description="Add VAT or another rate to apply it to products. The business default applies when a product has no rate."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="text-right">Rate</th>
                    <th>Pricing</th>
                    <th>Default</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.taxRates.map((rate) => (
                    <tr key={rate.id} className={cn(!rate.isActive && 'opacity-70')}>
                      <td className="text-sm font-medium text-ink-900">{rate.name}</td>
                      <td className="text-right font-mono text-sm text-ink-800">{Number(rate.rate).toFixed(2)}%</td>
                      <td className="text-xs text-ink-600">{rate.isInclusive ? 'Tax inclusive' : 'Added on top'}</td>
                      <td>
                        {rate.isDefault ? (
                          <span className="badge-green inline-flex items-center gap-1">
                            <BadgeCheck className="h-3 w-3" /> Default
                          </span>
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={rate.isActive ? 'ACTIVE' : 'INACTIVE'} label={rate.isActive ? 'Active' : 'Archived'} />
                      </td>
                      <td className="text-right">
                        {canManageSettings ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              onClick={() => {
                                setTaxError(null);
                                setTaxForm({
                                  id: rate.id,
                                  name: rate.name,
                                  rate: rate.rate,
                                  isInclusive: rate.isInclusive,
                                  isDefault: rate.isDefault,
                                });
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                            {rate.isActive ? (
                              <button
                                type="button"
                                className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                                onClick={() => setArchiveTax(rate)}
                                disabled={rate.isDefault}
                                title={rate.isDefault ? 'Choose another default rate before archiving this one.' : undefined}
                              >
                                <Archive className="h-3.5 w-3.5" /> Archive
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => restoreTax.mutate(rate)}
                                disabled={restoreTax.isPending}
                              >
                                <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-ink-400">Read-only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'branches' ? (
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-ink-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">Branches</h2>
              <p className="text-xs text-ink-500">
                Each branch keeps its own stock ledger. Deactivating a branch keeps its history and stops new activity.
              </p>
            </div>
            {canManageBranches ? (
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => {
                  setBranchError(null);
                  setBranchForm({ name: '', code: '', address: '', phone: '' });
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add branch
              </button>
            ) : null}
          </div>
          {branches.isLoading ? (
            <TableSkeleton rows={5} cols={3} />
          ) : branches.isError ? (
            <ErrorState message={errorMessage(branches.error)} onRetry={() => void branches.refetch()} />
          ) : !(branches.data ?? []).length ? (
            <EmptyState icon={<Store className="h-5 w-5" />} title="No branches" description="Add the first branch to start trading." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {(branches.data ?? []).map((location) => (
                <li key={location.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <span
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                      location.isActive ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-400',
                    )}
                  >
                    <MapPin className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-ink-900">{location.name}</p>
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-600">
                        {location.code}
                      </span>
                      {location.isDefault ? <span className="badge-blue">Default</span> : null}
                      <StatusBadge
                        status={location.isActive ? 'ACTIVE' : 'INACTIVE'}
                        label={location.isActive ? 'Trading' : 'Closed'}
                      />
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
                      {location.address ? <span>{location.address}</span> : null}
                      {location.phone ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {location.phone}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {canManageBranches ? (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          setBranchError(null);
                          setBranchForm({
                            id: location.id,
                            name: location.name,
                            code: location.code,
                            address: location.address ?? '',
                            phone: location.phone ?? '',
                          });
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      {location.isActive ? (
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                          onClick={() => setToggleBranch(location)}
                          disabled={location.isDefault}
                          title={location.isDefault ? 'The default branch cannot be deactivated.' : undefined}
                        >
                          <Archive className="h-3.5 w-3.5" /> Close
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setToggleBranch(location)}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" /> Reopen
                        </button>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === 'team' ? (
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-ink-100 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">Team</h2>
                <p className="text-xs text-ink-500">
                  {canReadUsers
                    ? 'Roles control what each person can see and do. Branch assignments scope their access.'
                    : 'Team management requires the users permission.'}
                </p>
              </div>
              {canManageUsers ? (
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => {
                    setTeamError(null);
                    setInvite({
                      name: '',
                      email: '',
                      role: 'CASHIER',
                      password: '',
                      locationIds: user?.locationIds?.length ? [user.locationIds[0]!] : [],
                    });
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" /> Add team member
                </button>
              ) : null}
            </div>
            {canReadUsers ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <SearchInput value={teamSearch} onChange={(value) => { setTeamSearch(value); setTeamPage(1); }} placeholder="Search name or email…" className="sm:w-72" />
                <select
                  className="select sm:w-44"
                  value={teamRole}
                  onChange={(event) => { setTeamRole(event.target.value as '' | UserRole); setTeamPage(1); }}
                  aria-label="Filter by role"
                >
                  <option value="">All roles</option>
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
                <select
                  className="select sm:w-40"
                  value={teamStatus}
                  onChange={(event) => { setTeamStatus(event.target.value as '' | 'ACTIVE' | 'SUSPENDED'); setTeamPage(1); }}
                  aria-label="Filter by status"
                >
                  <option value="">All statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </div>
            ) : null}
          </div>

          {!canReadUsers ? (
            <p className="px-4 py-8 text-center text-sm text-ink-500">You do not have access to the team directory.</p>
          ) : team.isLoading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : team.isError ? (
            <ErrorState message={errorMessage(team.error)} onRetry={() => void team.refetch()} />
          ) : !team.data?.data.length ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title="No team members match"
              description="Clear the filters or add a team member to get started."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Role</th>
                      <th>Branches</th>
                      <th>Last sign-in</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.data.data.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <p className="text-sm font-semibold text-ink-900">
                            {member.name}
                            {member.id === user?.id ? <span className="ml-1.5 text-[10px] font-medium text-brand-600">you</span> : null}
                          </p>
                          <p className="text-[11px] text-ink-500">{member.email}</p>
                          {!member.emailVerifiedAt ? (
                            <p className="mt-0.5 text-[10px] text-accent-700">Email not verified</p>
                          ) : null}
                        </td>
                        <td>
                          <p className="text-xs font-medium text-ink-800">{ROLE_LABELS[member.role]}</p>
                          <p className="max-w-[190px] text-[10px] leading-snug text-ink-400">{ROLE_NOTES[member.role]}</p>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {member.locations.length ? (
                              member.locations.map((location) => (
                                <span key={location.id} className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
                                  {location.name}
                                </span>
                              ))
                            ) : (
                              <span className="text-[11px] text-ink-400">None</span>
                            )}
                          </div>
                        </td>
                        <td className="text-xs text-ink-600">
                          {member.lastLoginAt ? relativeTime(member.lastLoginAt) : 'Never'}
                          {memberIsLocked(member) ? (
                            <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-red-600">
                              <Lock className="h-3 w-3" /> Locked
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <StatusBadge status={member.status} />
                        </td>
                        <td className="text-right">
                          {canManageUsers ? (
                            <div className="flex flex-wrap justify-end gap-1">
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => {
                                  setTeamError(null);
                                  setMemberForm({
                                    id: member.id,
                                    name: member.name,
                                    role: member.role,
                                    status: member.status,
                                    locationIds: member.locationIds,
                                  });
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" /> Edit
                              </button>
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => {
                                  setTeamError(null);
                                  setResetTarget(member);
                                  setResetPassword('');
                                }}
                              >
                                <KeyRound className="h-3.5 w-3.5" /> Password
                              </button>
                              {memberIsLocked(member) ? (
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm"
                                  onClick={() => unlockMember.mutate(member)}
                                  disabled={unlockMember.isPending}
                                >
                                  <Unlock className="h-3.5 w-3.5" /> Unlock
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => setSessionsTarget(member)}
                              >
                                <Clock className="h-3.5 w-3.5" /> Sessions
                              </button>
                              {member.id !== user?.id && member.status === 'ACTIVE' ? (
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                                  onClick={() => setArchiveMember(member)}
                                >
                                  <Archive className="h-3.5 w-3.5" /> Deactivate
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[11px] text-ink-400">Read-only</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {team.data ? (
                <Pagination
                  page={team.data.page}
                  pageSize={team.data.pageSize}
                  total={team.data.total}
                  onPage={setTeamPage}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {tab === 'subscription' ? (
        <div className="space-y-4">
          <div className="card card-pad">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Current plan</p>
                <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-ink-950">
                  {data.usage.plan.name}
                  <StatusBadge status={data.subscription.status} />
                  {!data.subscription.active ? <span className="badge-red">Inactive</span> : null}
                </h2>
                <p className="mt-1 max-w-xl text-sm text-ink-500">
                  {data.subscription.status === 'TRIAL' && data.subscription.trialEndsAt
                    ? `Trial ends ${formatDate(data.subscription.trialEndsAt)}${data.subscription.trialDaysRemaining !== null ? ` · ${data.subscription.trialDaysRemaining} day${data.subscription.trialDaysRemaining === 1 ? '' : 's'} remaining` : ''}.`
                    : data.subscription.status === 'ACTIVE'
                      ? 'Your subscription is active.'
                      : 'This subscription is not currently active. Contact support to restore access.'}
                </p>
              </div>
              <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-[11px] text-ink-600">
                <p className="flex items-center gap-1 font-semibold text-ink-800">
                  <CreditCard className="h-3.5 w-3.5" /> Billing for this build
                </p>
                <p className="mt-1 max-w-[240px]">
                  Plan status is recorded, but no card or mobile-money payment is processed in this deployment.
                  Plan changes are handled by support.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Meter used={data.usage.activeUsers} limit={data.usage.plan.maxUsers} label="Active users" />
              <Meter used={data.usage.locations} limit={data.usage.plan.maxLocations} label="Branches" />
            </div>
          </div>

          {plans.isLoading ? (
            <div className="card"><TableSkeleton rows={4} cols={3} /></div>
          ) : plans.isError ? (
            <div className="card"><ErrorState message={errorMessage(plans.error)} onRetry={() => void plans.refetch()} /></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {(plans.data?.plans ?? []).map((plan) => {
                const current = plan.id === data.subscription.plan;
                return (
                  <div
                    key={plan.id}
                    className={cn(
                      'card card-pad relative flex flex-col',
                      current && 'border-brand-400 ring-1 ring-brand-200',
                    )}
                  >
                    {current ? (
                      <span className="absolute right-3 top-3 rounded-full bg-brand-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Current
                      </span>
                    ) : null}
                    <h3 className="text-base font-semibold text-ink-950">{plan.name}</h3>
                    <p className="mt-1 min-h-[40px] text-xs text-ink-500">{plan.description}</p>
                    <dl className="mt-3 space-y-1 border-y border-ink-100 py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-500">Users</dt>
                        <dd className="font-mono font-semibold text-ink-800">{planLimit(plan.maxUsers)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-500">Branches</dt>
                        <dd className="font-mono font-semibold text-ink-800">{planLimit(plan.maxLocations)}</dd>
                      </div>
                    </dl>
                    <ul className="mt-3 flex-1 space-y-1.5">
                      {FEATURE_LABELS.map((feature) => {
                        const enabled = plan.features[feature.key];
                        return (
                          <li key={feature.key} className="flex items-center gap-2 text-xs">
                            {enabled ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 shrink-0 text-ink-300" />
                            )}
                            <span className={enabled ? 'text-ink-700' : 'text-ink-400'}>{feature.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-xl border border-accent-200 bg-accent-50 px-3 py-2.5 text-[11px] leading-relaxed text-accent-900">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" /> Honest limitation
            </div>
            <p className="mt-1">
              There is no self-service checkout in this build. Nothing here will charge a card, and no upgrade is
              simulated. Contact your KampalaSmart account manager to change plan or renew a subscription.
            </p>
          </div>
        </div>
      ) : null}

      <Modal
        open={taxForm !== null}
        onClose={() => setTaxForm(null)}
        title={taxForm?.id ? 'Edit tax rate' : 'Add tax rate'}
        description="Rates apply to products assigned to them. Existing sales keep their recorded rate."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setTaxForm(null)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submitTax} disabled={saveTax.isPending}>
              {saveTax.isPending ? <Spinner /> : null} Save rate
            </button>
          </>
        }
      >
        {taxForm ? (
          <div className="space-y-3">
            {taxError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{taxError}</div>
            ) : null}
            <Field label="Name" htmlFor="tax-name" required>
              <input
                id="tax-name"
                className="input"
                value={taxForm.name}
                onChange={(event) => setTaxForm({ ...taxForm, name: event.target.value })}
                placeholder="VAT 18%"
                maxLength={60}
              />
            </Field>
            <Field label="Rate (%)" htmlFor="tax-rate" required hint="Up to three decimal places.">
              <input
                id="tax-rate"
                type="number"
                min="0"
                max="100"
                step="0.001"
                className="input"
                value={taxForm.rate}
                onChange={(event) => setTaxForm({ ...taxForm, rate: event.target.value })}
              />
            </Field>
            <Toggle
              checked={taxForm.isInclusive}
              onChange={(next) => setTaxForm({ ...taxForm, isInclusive: next })}
              label="Rate is included in the price"
              description="When off, tax is added to the selling price at the till."
            />
            <Toggle
              checked={taxForm.isDefault}
              onChange={(next) => setTaxForm({ ...taxForm, isDefault: next })}
              label="Use as the default rate"
              description="The default is used where a product has no specific rate."
            />
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={archiveTax !== null}
        onClose={() => setArchiveTax(null)}
        onConfirm={() => archiveTax && archiveTaxRate.mutate(archiveTax)}
        title="Archive this tax rate?"
        message={
          <>
            <p>
              <span className="font-semibold text-ink-900">{archiveTax?.name}</span> will no longer be selectable for
              new products. Historical sales keep the rate they were recorded with.
            </p>
            <p className="mt-2">This is an archive, not a deletion. You can restore it later.</p>
          </>
        }
        confirmLabel="Archive rate"
        tone="danger"
        busy={archiveTaxRate.isPending}
      />

      <Modal
        open={branchForm !== null}
        onClose={() => setBranchForm(null)}
        title={branchForm?.id ? 'Edit branch' : 'Add branch'}
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setBranchForm(null)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submitBranch} disabled={saveBranch.isPending}>
              {saveBranch.isPending ? <Spinner /> : null} Save branch
            </button>
          </>
        }
      >
        {branchForm ? (
          <div className="space-y-3">
            {branchError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{branchError}</div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr]">
              <Field label="Branch name" htmlFor="branch-name" required>
                <input
                  id="branch-name"
                  className="input"
                  value={branchForm.name}
                  onChange={(event) => setBranchForm({ ...branchForm, name: event.target.value })}
                  maxLength={120}
                />
              </Field>
              <Field label="Code" htmlFor="branch-code" required hint="Letters, numbers, dash.">
                <input
                  id="branch-code"
                  className="input font-mono uppercase"
                  value={branchForm.code}
                  onChange={(event) => setBranchForm({ ...branchForm, code: event.target.value.toUpperCase() })}
                  maxLength={16}
                />
              </Field>
            </div>
            <Field label="Address" htmlFor="branch-address">
              <input
                id="branch-address"
                className="input"
                value={branchForm.address}
                onChange={(event) => setBranchForm({ ...branchForm, address: event.target.value })}
                maxLength={300}
              />
            </Field>
            <Field label="Phone" htmlFor="branch-phone">
              <input
                id="branch-phone"
                className="input"
                value={branchForm.phone}
                onChange={(event) => setBranchForm({ ...branchForm, phone: event.target.value })}
                maxLength={30}
              />
            </Field>
            <p className="flex items-start gap-1.5 text-[11px] text-ink-500">
              <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Each branch maintains a separate stock ledger. Stock transfers move quantities between them with a
              full audit trail.
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={toggleBranch !== null}
        onClose={() => setToggleBranch(null)}
        onConfirm={() => toggleBranch && changeBranchState.mutate(toggleBranch)}
        title={toggleBranch?.isActive ? 'Close this branch?' : 'Reopen this branch?'}
        message={
          toggleBranch?.isActive ? (
            <>
              <p>
                <span className="font-semibold text-ink-900">{toggleBranch.name}</span> will stop accepting new sales,
                purchases and transfers. Historical data is preserved.
              </p>
              <p className="mt-2">You can reopen it at any time.</p>
            </>
          ) : (
            <p>
              <span className="font-semibold text-ink-900">{toggleBranch?.name}</span> will become available for
              trading again, with its previous stock balances intact.
            </p>
          )
        }
        confirmLabel={toggleBranch?.isActive ? 'Close branch' : 'Reopen branch'}
        tone={toggleBranch?.isActive ? 'danger' : 'primary'}
        busy={changeBranchState.isPending}
      />

      <Modal
        open={invite !== null}
        onClose={() => setInvite(null)}
        title="Add team member"
        description="Creates the account immediately. No invitation email is sent by this deployment."
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setInvite(null)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submitInvite} disabled={createMember.isPending}>
              {createMember.isPending ? <Spinner /> : <UserPlus className="h-4 w-4" />} Create account
            </button>
          </>
        }
      >
        {invite ? (
          <div className="space-y-3">
            {teamError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{teamError}</div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" htmlFor="invite-name" required>
                <input
                  id="invite-name"
                  className="input"
                  value={invite.name}
                  onChange={(event) => setInvite({ ...invite, name: event.target.value })}
                  maxLength={120}
                />
              </Field>
              <Field label="Email" htmlFor="invite-email" required>
                <input
                  id="invite-email"
                  type="email"
                  className="input"
                  value={invite.email}
                  onChange={(event) => setInvite({ ...invite, email: event.target.value })}
                  maxLength={255}
                />
              </Field>
            </div>
            <Field label="Role" htmlFor="invite-role" hint={ROLE_NOTES[invite.role]}>
              <select
                id="invite-role"
                className="select"
                value={invite.role}
                onChange={(event) => setInvite({ ...invite, role: event.target.value as UserRole })}
              >
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                  <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Temporary password"
              htmlFor="invite-password"
              required
              hint="At least 10 characters with uppercase, lowercase and a number. Share it securely; the person should change it after signing in."
            >
              <input
                id="invite-password"
                type="password"
                className="input"
                value={invite.password}
                onChange={(event) => setInvite({ ...invite, password: event.target.value })}
                autoComplete="new-password"
                maxLength={200}
              />
            </Field>
            <Field label="Branches" required hint="A person must be assigned to at least one active branch.">
              <BranchChecks
                locations={activeLocations}
                selected={invite.locationIds}
                onChange={(locationIds) => setInvite({ ...invite, locationIds })}
              />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={memberForm !== null}
        onClose={() => setMemberForm(null)}
        title="Edit team member"
        description="Changing role or suspending a person revokes their active sessions."
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setMemberForm(null)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submitMember} disabled={updateMember.isPending}>
              {updateMember.isPending ? <Spinner /> : null} Save member
            </button>
          </>
        }
      >
        {memberForm ? (
          <div className="space-y-3">
            {teamError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{teamError}</div>
            ) : null}
            <Field label="Full name" htmlFor="member-name" required>
              <input
                id="member-name"
                className="input"
                value={memberForm.name}
                onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })}
                maxLength={120}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Role" htmlFor="member-role" hint={ROLE_NOTES[memberForm.role]}>
                <select
                  id="member-role"
                  className="select"
                  value={memberForm.role}
                  disabled={memberForm.id === user?.id}
                  onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value as UserRole })}
                >
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status" htmlFor="member-status">
                <select
                  id="member-status"
                  className="select"
                  value={memberForm.status}
                  disabled={memberForm.id === user?.id}
                  onChange={(event) =>
                    setMemberForm({ ...memberForm, status: event.target.value as 'ACTIVE' | 'SUSPENDED' })
                  }
                >
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </Field>
            </div>
            <Field label="Branches" required>
              <BranchChecks
                locations={activeLocations}
                selected={memberForm.locationIds}
                onChange={(locationIds) => setMemberForm({ ...memberForm, locationIds })}
              />
            </Field>
            {memberForm.id === user?.id ? (
              <p className="text-[11px] text-ink-500">
                You cannot change your own role or suspend yourself. Ask another owner to do it.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title="Reset password"
        description="The new password is set immediately and all active sessions for this person are revoked."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setResetTarget(null)}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setTeamError(null);
                if (!validPassword(resetPassword)) {
                  setTeamError('Use at least 10 characters with uppercase, lowercase and a number.');
                  return;
                }
                resetMemberPassword.mutate();
              }}
              disabled={resetMemberPassword.isPending}
            >
              {resetMemberPassword.isPending ? <Spinner /> : <KeyRound className="h-4 w-4" />} Set password
            </button>
          </>
        }
      >
        {resetTarget ? (
          <div className="space-y-3">
            {teamError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{teamError}</div>
            ) : null}
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
              Account: <span className="font-semibold text-ink-800">{resetTarget.name}</span> · {resetTarget.email}
            </p>
            <Field label="New password" htmlFor="reset-password" required hint="At least 10 characters with uppercase, lowercase and a number.">
              <input
                id="reset-password"
                type="password"
                className="input"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                autoComplete="new-password"
                maxLength={200}
              />
            </Field>
            <p className="text-[11px] text-ink-500">Share this password through a secure channel. It is never emailed by this deployment.</p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={sessionsTarget !== null}
        onClose={() => setSessionsTarget(null)}
        title="Sessions"
        description={sessionsTarget ? `${sessionsTarget.name} · ${sessionsTarget.email}` : undefined}
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setSessionsTarget(null)}>Close</button>
            {sessionsTarget && (sessions.data?.data ?? []).some((session) => session.active) ? (
              <button
                type="button"
                className="btn-danger"
                onClick={() =>
                  sessionsTarget &&
                  revokeMemberSessions.mutate({ member: sessionsTarget })
                }
                disabled={revokeMemberSessions.isPending}
              >
                Revoke all sessions
              </button>
            ) : null}
          </>
        }
      >
        {sessions.isLoading ? (
          <div className="py-6 text-center text-sm text-ink-500"><Spinner className="mx-auto" /></div>
        ) : sessions.isError ? (
          <ErrorState message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
        ) : !sessions.data?.data.length ? (
          <p className="py-4 text-center text-sm text-ink-500">No sessions have been recorded for this person.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {sessions.data.data.map((session) => (
              <li key={session.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink-800">
                    {session.userAgent ? session.userAgent.slice(0, 70) : 'Unknown device'}
                  </p>
                  <p className="text-[11px] text-ink-500">
                    {session.ip ?? 'IP not recorded'} · started {formatDate(session.createdAt, true)} · last used{' '}
                    {relativeTime(session.lastUsedAt)}
                  </p>
                  {session.revokedAt ? (
                    <p className="text-[11px] text-ink-400">Revoked {relativeTime(session.revokedAt)}</p>
                  ) : !session.active ? (
                    <p className="text-[11px] text-ink-400">Expired</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={session.active ? 'ACTIVE' : 'INACTIVE'} label={session.active ? 'Active' : 'Ended'} />
                  {session.active && sessionsTarget ? (
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                      onClick={() => revokeMemberSessions.mutate({ member: sessionsTarget, sessionId: session.id })}
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={archiveMember !== null}
        onClose={() => setArchiveMember(null)}
        onConfirm={() => archiveMember && archiveTeamMember.mutate(archiveMember)}
        title="Deactivate this team member?"
        message={
          <>
            <p>
              <span className="font-semibold text-ink-900">{archiveMember?.name}</span> will no longer be able to sign
              in, and their active sessions will be revoked.
            </p>
            <p className="mt-2">
              Sales, stock movements and audit entries they recorded are retained. A deactivated account can be
              restored by an owner.
            </p>
          </>
        }
        confirmLabel="Deactivate"
        tone="danger"
        busy={archiveTeamMember.isPending}
      />
    </div>
  );
}
