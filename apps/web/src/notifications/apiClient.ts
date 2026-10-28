/**
 * Fetch adapter retained for the Notification Studio components adapted from QuantaEdge.
 * Authentication tokens are read only at request time and never placed in URLs.
 */
const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

function resolveApiInput(input: RequestInfo | URL): RequestInfo | URL {
  if (!configuredApiBaseUrl) return input;
  const base = `${configuredApiBaseUrl}/`;
  if (typeof input === 'string') return new URL(input, base).toString();
  if (input instanceof URL) return new URL(input.toString(), base);
  return new Request(new URL(input.url, base), input);
}
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  const token = typeof window !== 'undefined' ? window.sessionStorage.getItem('qe_staff_token') : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(resolveApiInput(input), { ...init, headers });
}
