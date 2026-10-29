'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthSession, Location, SessionUser } from '@kampalasmart/shared';
import type { Permission } from '@kampalasmart/shared';
import { api, ApiError } from './api';

export interface LoginResponse extends AuthSession {
  accessToken: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  business: AuthSession['business'] | null;
  locations: Location[];
  activeLocationId: string;
  activeLocation: Location | null;
  loading: boolean;
  offlineSession: boolean;
  setActiveLocationId: (id: string) => void;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  register: (input: {
    businessName: string;
    ownerName: string;
    email: string;
    password: string;
    phone?: string;
    currency?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: Permission) => boolean;
  isPrivileged: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LOCATION_KEY = 'ks_active_location';
const SESSION_CACHE_KEY = 'ks_session_cache';

/** Cache only the profile needed to render the offline shell. Never tokens. */
function cacheSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({
        user: session.user,
        business: session.business,
        locations: session.locations,
        cachedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Storage may be disabled or full; the online session still works.
  }
}

function readCachedSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession> | null;
    if (!parsed?.user?.id || !parsed.business || !Array.isArray(parsed.locations)) return null;
    return {
      user: parsed.user,
      business: parsed.business,
      locations: parsed.locations,
      // The CSRF token is deliberately not persisted; requests read the live cookie.
      csrfToken: '',
    };
  } catch {
    return null;
  }
}

function clearCachedSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_CACHE_KEY);
}

function isOfflineFailure(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 0 ||
      error.status === 503 ||
      error.code === 'NETWORK_ERROR' ||
      error.code === 'OFFLINE')
  );
}


export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineSession, setOfflineSession] = useState(false);
  const [locationOverride, setLocationOverride] = useState<string | null>(null);

  const applySession = useCallback((next: AuthSession, cached = false) => {
    setSession(next);
    setOfflineSession(cached);
    if (!cached) cacheSession(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const stored = typeof window !== 'undefined' ? localStorage.getItem(LOCATION_KEY) : null;
    if (stored) setLocationOverride(stored);
    const cached = readCachedSession();
    api
      .get<AuthSession>('/auth/me')
      .then((next) => {
        if (!cancelled) applySession(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (cached && isOfflineFailure(error)) {
          setSession(cached);
          setOfflineSession(true);
          return;
        }
        setSession(null);
        setOfflineSession(false);
        if (error instanceof ApiError && error.status === 401) clearCachedSession();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const activeLocationId = useMemo(() => {
    const ids = session?.locations.map((location) => location.id) ?? [];
    if (locationOverride && ids.includes(locationOverride)) return locationOverride;
    const preferred = session?.locations.find((location) => location.isDefault) ?? session?.locations[0];
    return preferred?.id ?? '';
  }, [session, locationOverride]);

  const activeLocation = useMemo(
    () => session?.locations.find((location) => location.id === activeLocationId) ?? null,
    [session, activeLocationId],
  );

  const setActiveLocationId = useCallback((id: string) => {
    setLocationOverride(id);
    localStorage.setItem(LOCATION_KEY, id);
  }, []);

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const next = await api.post<LoginResponse>('/auth/login', { email, password, remember });
      applySession(next);
      const defaultLocation =
        next.locations.find((location) => location.isDefault) ?? next.locations[0];
      if (defaultLocation) {
        setLocationOverride(defaultLocation.id);
        localStorage.setItem(LOCATION_KEY, defaultLocation.id);
      }
    },
    [applySession],
  );

  const register = useCallback(
    async (input: {
      businessName: string;
      ownerName: string;
      email: string;
      password: string;
      phone?: string;
      currency?: string;
    }) => {
      const next = await api.post<LoginResponse>('/auth/register', input);
      applySession(next);
      const defaultLocation =
        next.locations.find((location) => location.isDefault) ?? next.locations[0];
      if (defaultLocation) {
        setLocationOverride(defaultLocation.id);
        localStorage.setItem(LOCATION_KEY, defaultLocation.id);
      }
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      const canLogOutLocally =
        error instanceof ApiError &&
        (error.status === 401 || isOfflineFailure(error));
      if (!canLogOutLocally) throw error;
    }
    clearCachedSession();
    setSession(null);
    setOfflineSession(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(LOCATION_KEY);
      localStorage.removeItem('ks_device_key');
      router.replace('/login');
    }
  }, [router]);

  const refresh = useCallback(async () => {
    const next = await api.get<AuthSession>('/auth/me');
    applySession(next);
  }, [applySession]);

  const can = useCallback(
    (permission: Permission) => session?.user.permissions.includes(permission) ?? false,
    [session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      business: session?.business ?? null,
      locations: session?.locations ?? [],
      activeLocationId,
      activeLocation,
      loading,
      offlineSession,
      setActiveLocationId,
      login,
      register,
      logout,
      refresh,
      can,
      isPrivileged: session?.user.role === 'OWNER' || session?.user.role === 'MANAGER',
    }),
    [
      session,
      activeLocationId,
      activeLocation,
      loading,
      offlineSession,
      setActiveLocationId,
      login,
      register,
      logout,
      refresh,
      can,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
