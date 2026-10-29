import { useState, type FormEvent } from 'react';
import { apiRequestUrl } from '../apiClient';

type StaffSummary = {
  staffPublicId: string;
  fullName: string;
  dealershipPublicId: string;
  dealershipCode: string;
  roles: string[];
  permissions: string[];
};

type LoginResult = {
  accessToken: string;
  tokenType: 'Bearer' | string;
  expiresAt: string;
  staff: StaffSummary;
};

type ActivationResult = {
  dealershipCode: string;
  fullName: string;
  loginIdentifier: string;
};

/** Read JSON responses safely while preserving plain-text proxy/server errors. */
async function readResponseBody(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function responseErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (typeof payload === 'object' && payload !== null) {
    const failure = payload as { message?: unknown; detail?: unknown };
    if (typeof failure.message === 'string' && failure.message.trim()) return failure.message;
    if (typeof failure.detail === 'string' && failure.detail.trim()) return failure.detail;
  }
  return fallback;
}

export default function StaffLogin({ onLogin }: { onLogin: (result: LoginResult) => void }) {
  const [dealershipCode, setDealershipCode] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [activationMode, setActivationMode] = useState(false);
  const [activationToken, setActivationToken] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [activationMessage, setActivationMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setActivationMessage('');
    setBusy(true);
    try {
      const response = await fetch(apiRequestUrl('/api/v1/auth/staff/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ dealershipCode, login, password }),
      });
      const payload = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(responseErrorMessage(
          payload, 'Sign-in failed. Check your details and try again.'));
      }
      if (typeof payload !== 'object' || payload === null) {
        throw new Error('The server returned an unexpected response. Please try again.');
      }
      const successful = payload as LoginResult;
      if (!successful.accessToken || !successful.staff) {
        throw new Error('The server returned an incomplete sign-in response.');
      }
      onLogin(successful);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in right now.');
    } finally {
      setBusy(false);
    }
  }

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setActivationMessage('');
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(apiRequestUrl('/api/v1/auth/staff/activate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ activationToken: activationToken.trim(), password }),
      });
      const payload = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(responseErrorMessage(
          payload, 'Activation failed. Check your invitation token.'));
      }
      if (typeof payload !== 'object' || payload === null) {
        throw new Error('The server returned an unexpected response. Please try again.');
      }
      const activated = payload as ActivationResult;
      if (!activated.dealershipCode || !activated.loginIdentifier) {
        throw new Error('The server returned an incomplete activation response.');
      }
      setDealershipCode(activated.dealershipCode);
      setLogin(activated.loginIdentifier);
      setPassword('');
      setConfirmPassword('');
      setActivationToken('');
      setActivationMode(false);
      setActivationMessage(`Account activated for ${activated.fullName}. Sign in with the password you just created.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to activate the account right now.');
    } finally {
      setBusy(false);
    }
  }

  function toggleMode() {
    setActivationMode((active) => !active);
    setError('');
    setActivationMessage('');
    setPassword('');
    setConfirmPassword('');
  }

  return (
    <main className="auth-screen">
      <div className="auth-decoration auth-decoration-one" />
      <div className="auth-decoration auth-decoration-two" />
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">Q</div>
          <div><div className="brand-name">Quanta<span>Edge</span></div><div className="brand-caption">DEALERSHIP MANAGEMENT</div></div>
        </div>
        <div className="auth-eyebrow">LUCKY BAJAJ AGENCY</div>
        <h1>{activationMode ? 'Activate your account.' : 'Welcome back.'}</h1>
        <p className="auth-intro">{activationMode
          ? 'Paste the single-use staff invitation token from your dealership owner, then create a strong password.'
          : 'Sign in to your dealership workspace to manage sales, servicing and customer care.'}</p>
        {activationMessage && <div className="notice notice-success" role="status">{activationMessage}</div>}
        <form onSubmit={activationMode ? activate : submit} className="auth-form">
          {activationMode ? <>
            <label>Single-use activation token
              <input autoComplete="off" required maxLength={128} value={activationToken}
                onChange={(event) => setActivationToken(event.target.value)} placeholder="Paste your invitation token" />
            </label>
            <label>Create password
              <input type="password" autoComplete="new-password" required minLength={12} maxLength={72}
                value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" />
            </label>
            <label>Confirm password
              <input type="password" autoComplete="new-password" required minLength={12} maxLength={72}
                value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter the same password again" />
            </label>
          </> : <>
            <label>Dealership code
              <input autoComplete="organization" required maxLength={40} value={dealershipCode}
                onChange={(event) => setDealershipCode(event.target.value.toUpperCase())}
                placeholder="For example, LUCKY-BAJAJ" />
            </label>
            <label>Email or mobile number
              <input autoComplete="username" required maxLength={320} value={login}
                onChange={(event) => setLogin(event.target.value)} placeholder="Enter your registered email or phone" />
            </label>
            <label>Password
              <input type="password" autoComplete="current-password" required maxLength={72}
                value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" />
            </label>
          </>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? (activationMode ? 'Activating…' : 'Signing in…') : (activationMode ? 'Activate account securely' : 'Sign in securely')} <span>→</span>
          </button>
        </form>
        <button className="text-button auth-mode-toggle" type="button" onClick={toggleMode}>
          {activationMode ? '← Back to sign in' : 'Have a staff invitation? Activate invitation'}
        </button>
        <div className="auth-footnote"><span className="secure-mark">✓</span> Access is protected by your assigned dealership role.</div>
      </section>
      <div className="auth-footer">Powered by QuantaEdge <span>·</span> Smarter Decisions. Greater Growth.</div>
    </main>
  );
}

export type { LoginResult, StaffSummary };
