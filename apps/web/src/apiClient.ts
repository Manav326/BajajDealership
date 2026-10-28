export type ApiError = Error & { status?: number };

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export function apiRequestUrl(path: string): string {
  // Empty in local development: Vite/Docker proxy /api to the local Spring Boot API.
  return configuredApiBaseUrl ? new URL(path, `${configuredApiBaseUrl}/`).toString() : path;
}


export async function apiFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
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
