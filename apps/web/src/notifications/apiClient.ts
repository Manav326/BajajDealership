/**
 * Fetch adapter retained for the Notification Studio components adapted from QuantaEdge.
 * Authentication tokens are read only at request time and never placed in URLs.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  const token = typeof window !== 'undefined' ? window.sessionStorage.getItem('qe_staff_token') : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
