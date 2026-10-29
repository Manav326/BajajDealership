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

type AuthMode = 'login' | 'staff-activate' | 'owner-setup';

type BootstrapResult = {
  status: string;
  dealershipCode: string;
  ownerName: string;
  role: string;
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
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [activationToken, setActivationToken] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [ownerSetup, setOwnerSetup] = useState({
    dealershipCode: '',
    dealershipName: '',
    ownerName: '',
    email: '',
    phone: '',
  });
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
      setAuthMode('login');
      setActivationMessage(`Account activated for ${activated.fullName}. Sign in with the password you just created.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to activate the account right now.');
    } finally {
      setBusy(false);
    }
  }

  async function setupOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setActivationMessage('');

    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    if (!ownerSetup.email.trim() && !ownerSetup.phone.trim()) {
      setError('Enter an owner email address or mobile number so you can sign in.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(apiRequestUrl('/api/v1/system/bootstrap'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Bootstrap-Token': bootstrapToken.trim(),
        },
        body: JSON.stringify({
          dealershipCode: ownerSetup.dealershipCode.trim().toUpperCase(),
          dealershipName: ownerSetup.dealershipName.trim(),
          ownerName: ownerSetup.ownerName.trim(),
          email: ownerSetup.email.trim() || null,
          phone: ownerSetup.phone.trim() || null,
          password,
        }),
      });
      const payload = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(responseErrorMessage(
          payload, 'Dealership setup failed. Check the one-time setup token and your details.'));
      }
      if (typeof payload !== 'object' || payload === null) {
        throw new Error('The server returned an unexpected setup response. Please try again.');
      }

      const result = payload as BootstrapResult;
      if (!result.dealershipCode || !result.ownerName) {
        throw new Error('The server returned an incomplete owner setup response.');
      }

      // The setup token is not persisted. Move straight to the normal sign-in form.
      setDealershipCode(result.dealershipCode);
      setLogin(ownerSetup.email.trim() || ownerSetup.phone.trim());
      setBootstrapToken('');
      setActivationToken('');
      setPassword('');
      setConfirmPassword('');
      setAuthMode('login');
      setActivationMessage(
        `Dealership owner account created for ${result.ownerName}. Sign in using the credentials you just created.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to set up the dealership right now.');
    } finally {
      setBusy(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setAuthMode(nextMode);
    setError('');
    setActivationMessage('');
    setPassword('');
    setConfirmPassword('');
    setActivationToken('');
    setBootstrapToken('');
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
        <h1>{authMode === 'owner-setup'
          ? 'Set up your dealership.'
          : authMode === 'staff-activate' ? 'Activate your account.' : 'Welcome back.'}</h1>
        <p className="auth-intro">{authMode === 'owner-setup'
          ? 'First time here? Use the one-time setup token shown when the local Docker stack starts to create your dealership owner account.'
          : authMode === 'staff-activate'
            ? 'Paste the single-use staff invitation token from your dealership owner, then create a strong password.'
            : 'Sign in to your dealership workspace to manage sales, servicing and customer care.'}</p>
        {activationMessage && <div className="notice notice-success" role="status">{activationMessage}</div>}
        <form
          onSubmit={authMode === 'owner-setup' ? setupOwner : authMode === 'staff-activate' ? activate : submit}
          className="auth-form"
        >
          {authMode === 'owner-setup' ? <>
            <label>One-time dealership setup token
              <input autoComplete="off" required maxLength={128} value={bootstrapToken}
                onChange={(event) => setBootstrapToken(event.target.value)}
                placeholder="Paste the setup token from startup" />
            </label>
            <label>Dealership code
              <input autoComplete="organization" required maxLength={40} value={ownerSetup.dealershipCode}
                onChange={(event) => setOwnerSetup((current) => ({ ...current, dealershipCode: event.target.value.toUpperCase() }))}
                placeholder="For example, LUCKY-BAJAJ" />
            </label>
            <label>Dealership name
              <input autoComplete="organization-title" required maxLength={160} value={ownerSetup.dealershipName}
                onChange={(event) => setOwnerSetup((current) => ({ ...current, dealershipName: event.target.value }))}
                placeholder="Your dealership's display name" />
            </label>
            <label>Owner full name
              <input autoComplete="name" required maxLength={160} value={ownerSetup.ownerName}
                onChange={(event) => setOwnerSetup((current) => ({ ...current, ownerName: event.target.value }))}
                placeholder="Full name of the dealership owner" />
            </label>
            <label>Owner email address <span className="auth-field-optional">(optional if phone is provided)</span>
              <input type="email" autoComplete="email" maxLength={320} value={ownerSetup.email}
                onChange={(event) => setOwnerSetup((current) => ({ ...current, email: event.target.value }))}
                placeholder="owner@example.com" />
            </label>
            <label>Owner mobile number <span className="auth-field-optional">(optional if email is provided)</span>
              <input type="tel" autoComplete="tel" maxLength={32} value={ownerSetup.phone}
                onChange={(event) => setOwnerSetup((current) => ({ ...current, phone: event.target.value }))}
                placeholder="Registered mobile number" />
            </label>
            <label>Create password
              <input type="password" autoComplete="new-password" required minLength={12} maxLength={72}
                value={password} onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 12 characters" />
            </label>
            <label>Confirm password
              <input type="password" autoComplete="new-password" required minLength={12} maxLength={72}
                value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Enter the same password again" />
            </label>
          </> : authMode === 'staff-activate' ? <>
            <label>Single-use staff invitation token
              <input autoComplete="off" required maxLength={128} value={activationToken}
                onChange={(event) => setActivationToken(event.target.value)} placeholder="Paste your staff invitation token" />
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
            {busy
              ? (authMode === 'owner-setup' ? 'Setting up…' : authMode === 'staff-activate' ? 'Activating…' : 'Signing in…')
              : (authMode === 'owner-setup'
                ? 'Create dealership owner account'
                : authMode === 'staff-activate' ? 'Activate staff account securely' : 'Sign in securely')}
            <span>→</span>
          </button>
        </form>
        {authMode === 'login' ? <>
          <button className="text-button auth-mode-toggle" type="button" onClick={() => changeMode('owner-setup')}>
            First time here? Set up dealership owner
          </button>
          <button className="text-button auth-mode-toggle" type="button" onClick={() => changeMode('staff-activate')}>
            Have a staff invitation? Activate invitation
          </button>
        </> : <button className="text-button auth-mode-toggle" type="button" onClick={() => changeMode('login')}>
          ← Back to sign in
        </button>}
        <div className="auth-footnote"><span className="secure-mark">✓</span> Access is protected by your assigned dealership role.</div>
      </section>
      <div className="auth-footer">Powered by QuantaEdge <span>·</span> Smarter Decisions. Greater Growth.</div>
    </main>
  );
}

export type { LoginResult, StaffSummary };
