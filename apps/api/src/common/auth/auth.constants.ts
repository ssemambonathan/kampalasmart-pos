export const ACCESS_COOKIE = 'ks_at';
export const REFRESH_COOKIE = 'ks_rt';
export const CSRF_COOKIE = 'ks_csrf';
/** Refresh cookie is only sent to the auth endpoints that need it. */
export const REFRESH_COOKIE_PATH = '/api';

export const MAX_FAILED_LOGINS = 5;
export const ACCOUNT_LOCK_MINUTES = 15;
