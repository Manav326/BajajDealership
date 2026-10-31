export type ApiError = Error & { status?: number };

export function isTauriDesktopRuntime(): boolean {
  return typeof window !== 'undefined'
    && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export type DesktopApiTarget = 'hosted' | 'local-docker';

const DESKTOP_API_TARGET_KEY = 'qe_desktop_api_target';
const DEFAULT_DESKTOP_API_BASE_URL = 'https://lucky-bajaj-api.onrender.com/';
const LOCAL_DOCKER_API_BASE_URL = 'http://127.0.0.1:8080/';

export function getDesktopApiTarget(): DesktopApiTarget {
  if (!isTauriDesktopRuntime()) return 'hosted';
  try {
    return window.localStorage.getItem(DESKTOP_API_TARGET_KEY) === 'local-docker'
      ? 'local-docker'
      : 'hosted';
  } catch {
    return 'hosted';
  }
}

export function setDesktopApiTarget(target: DesktopApiTarget): void {
  if (!isTauriDesktopRuntime()) return;
  try {
    if (target === 'local-docker') {
      window.localStorage.setItem(DESKTOP_API_TARGET_KEY, target);
    } else {
      window.localStorage.removeItem(DESKTOP_API_TARGET_KEY);
    }
  } catch {
    // Keep the hosted default when browser storage is unavailable.
  }
}

function configuredApiBaseUrl(): string {
  if (isTauriDesktopRuntime() && getDesktopApiTarget() === 'local-docker') {
    return LOCAL_DOCKER_API_BASE_URL.replace(/\/+$/, '');
  }
  return (
    import.meta.env.VITE_API_BASE_URL
    ?? (isTauriDesktopRuntime() ? DEFAULT_DESKTOP_API_BASE_URL : '')
  ).trim().replace(/\/+$/, '');
}

const DESKTOP_INSTALLATION_KEY = 'lucky_bajaj_desktop_installation_id';

export function desktopRequestHeaders(): Record<string, string> {
  if (!isTauriDesktopRuntime()) return {};
  let installationId = window.localStorage.getItem(DESKTOP_INSTALLATION_KEY);
  if (!installationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installationId)) {
    installationId = window.crypto.randomUUID();
    window.localStorage.setItem(DESKTOP_INSTALLATION_KEY, installationId);
  }
  return {
    'X-Desktop-Installation-Id': installationId,
    'X-Desktop-App-Version': import.meta.env.VITE_APP_VERSION ?? '0.1.0',
  };
}

export function apiRequestUrl(path: string): string {
  // Empty in local development: Vite/Docker proxy /api to the local Spring Boot API.
  const baseUrl = configuredApiBaseUrl();
  return baseUrl ? new URL(path, `${baseUrl}/`).toString() : path;
}


export async function apiFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(desktopRequestHeaders())) {
    if (!headers.has(name)) headers.set(name, value);
  }
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  const isMultipartBody = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isMultipartBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(apiRequestUrl(path), { ...init, headers });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json() as { message?: string; detail?: string; error?: string };
      message = payload.message ?? payload.detail ?? payload.error ?? message;
    } catch {
      // Keep the safe HTTP-status message when the error body is not JSON.
    }
    const error = new Error(message) as ApiError;
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
