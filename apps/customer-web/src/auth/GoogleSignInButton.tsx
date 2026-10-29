import { useCallback, useEffect, useRef, useState } from 'react';
import type { CustomerProfile } from '../types/customer';

type GoogleCredentialResponse = { credential?: string };
type GoogleIdentity = {
  initialize: (options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    context?: 'signin' | 'signup' | 'use';
    error_callback?: (error: { type?: string }) => void;
  }) => void;
  renderButton: (target: HTMLElement, options: Record<string, string | number | boolean>) => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
}

export type CustomerGoogleSession = {
  accessToken: string;
  expiresAt: string;
  customer: CustomerProfile;
};

type Props = {
  requestUrl: (path: string) => string;
  dealershipCode: string;
  context: 'signin' | 'signup';
  onAuthenticated: (session: CustomerGoogleSession) => void;
};

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window !== 'undefined' && window.google?.accounts?.id) return Promise.resolve();
  if (!googleScriptPromise) {
    googleScriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-qe-google-identity="true"]');
      const script = existing ?? document.createElement('script');
      const loaded = () => resolve();
      const failed = () => {
        googleScriptPromise = null;
        reject(new Error('Google sign-in could not be loaded. Check your connection and try again.'));
      };
      script.addEventListener('load', loaded, { once: true });
      script.addEventListener('error', failed, { once: true });
      if (!existing) {
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.dataset.qeGoogleIdentity = 'true';
        document.head.appendChild(script);
      }
      if (window.google?.accounts?.id) resolve();
    });
  }
  return googleScriptPromise;
}

async function request<T>(requestUrl: (path: string) => string, path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(requestUrl(path), {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  });
  const body = await response.text();
  let data: unknown = null;
  if (body) {
    try { data = JSON.parse(body); } catch { data = body; }
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'message' in data
      ? String((data as { message: unknown }).message)
      : typeof data === 'string' && data ? data : `Google sign-in failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

export default function GoogleSignInButton({ requestUrl, dealershipCode, context, onAuthenticated }: Props) {
  const target = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const receiveCredential = useCallback(async (response: GoogleCredentialResponse) => {
    const credential = String(response.credential ?? '').trim();
    if (!credential) {
      setError('Google did not return a sign-in credential. Please try again.');
      return;
    }
    const code = dealershipCode.trim().toUpperCase();
    if (!code) {
      setError('Enter your dealership code before continuing with Google.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const session = await request<CustomerGoogleSession>(requestUrl, '/api/v1/customer/auth/google', {
        method: 'POST',
        body: JSON.stringify({ dealershipCode: code, credential }),
      });
      if (!session.accessToken || !session.customer) throw new Error('A valid customer session could not be confirmed.');
      onAuthenticated(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google sign-in could not be completed.');
    } finally {
      setBusy(false);
    }
  }, [requestUrl, dealershipCode, onAuthenticated]);

  useEffect(() => {
    let active = true;
    setReady(false);
    setError('');
    const initialize = async () => {
      const config = await request<{ configured: boolean; clientId: string }>(
        requestUrl, '/api/v1/customer/auth/google/config',
      );
      if (!config.configured || !config.clientId?.trim()) {
        throw new Error('Google sign-in is not configured on this server yet. Ask the administrator to set GOOGLE_WEB_CLIENT_ID.');
      }
      await loadGoogleIdentityServices();
      if (!active || !target.current || !window.google?.accounts?.id) return;
      target.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: config.clientId.trim(),
        callback: (result) => { void receiveCredential(result); },
        auto_select: false,
        cancel_on_tap_outside: true,
        context,
        error_callback: () => setError('Google sign-in was cancelled or could not be started.'),
      });
      window.google.accounts.id.renderButton(target.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: context === 'signup' ? 'signup_with' : 'continue_with',
        shape: 'pill',
        logo_alignment: 'left',
        width: Math.min(320, Math.max(240, target.current.clientWidth || 320)),
        locale: 'en',
      });
      setReady(true);
    };
    void initialize().catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Google sign-in could not be loaded.');
    });
    return () => { active = false; };
  }, [requestUrl, context, receiveCredential]);

  return (
    <div className="google-signin">
      <div className="google-signin__frame">
        <div ref={target} className="google-signin__target" aria-label={context === 'signup' ? 'Sign up with Google' : 'Sign in with Google'} />
      </div>
      {busy && <p className="google-signin__status" role="status">Verifying your Google account securely…</p>}
      {!ready && !error && !busy && <p className="google-signin__status" role="status">Preparing secure Google sign-in…</p>}
      {error && <p className="google-signin__error" role="alert">{error}</p>}
    </div>
  );
}
