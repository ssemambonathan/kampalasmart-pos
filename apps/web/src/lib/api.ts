const API_BASE = '/api/backend';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  requestId?: string;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

type QueryValue = string | number | boolean | null | undefined;

export function toQueryString(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  retryAuth?: boolean;
}

async function parseError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const envelope = body as
    | { error?: { code?: string; message?: string; details?: unknown; requestId?: string } }
    | null;
  const detail = envelope?.error;
  return new ApiError(
    response.status,
    detail?.code ?? `HTTP_${response.status}`,
    detail?.message ?? 'The request could not be completed.',
    detail?.details,
    detail?.requestId,
  );
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('ks_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached. Check your connection.');
  }

  if (response.status === 401 && options.retryAuth !== false) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, { ...options, retryAuth: false });
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get<T>(path: string, params?: Record<string, QueryValue>, signal?: AbortSignal): Promise<T> {
    return request<T>(`${path}${toQueryString(params)}`, { signal });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
};

export async function downloadFile(path: string, filenameHint?: string): Promise<void> {
  const csrf = readCookie('ks_csrf');
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: csrf ? { 'x-csrf-token': csrf } : undefined,
  });
  if (!response.ok) throw await parseError(response);
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : (filenameHint ?? 'export.csv');
  const blob = await response.blob();
  saveBlob(blob, filename);
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export endpoints in this API return `{ filename, contentType, content }` so the
 * payload stays inspectable through the same JSON contract as every other route.
 * This helper turns that envelope (or a real file response) into a browser download.
 */
export async function downloadExport(path: string, filenameHint?: string): Promise<void> {
  const csrf = readCookie('ks_csrf');
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: csrf ? { 'x-csrf-token': csrf } : undefined,
  });
  if (!response.ok) throw await parseError(response);
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await response.json()) as { filename?: string; contentType?: string; content?: string };
    if (typeof body.content !== 'string') {
      throw new ApiError(response.status, 'EXPORT_INVALID', 'The export did not contain any data.');
    }
    saveBlob(
      new Blob([body.content], { type: body.contentType ?? 'text/csv; charset=utf-8' }),
      body.filename ?? filenameHint ?? 'export.csv',
    );
    return;
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : (filenameHint ?? 'export.csv');
  saveBlob(await response.blob(), filename);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}
