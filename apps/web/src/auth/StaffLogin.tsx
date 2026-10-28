import { useState, type FormEvent } from 'react';

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

export default function StaffLogin({ onLogin }: { onLogin: (result: LoginResult) => void }) {
  const [dealershipCode, setDealershipCode] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/v1/auth/staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ dealershipCode, login, password }),
      });
      const result = await response.json() as LoginResult | { message?: string; detail?: string };
      if (!response.ok) {
        const failure = result as { message?: string; detail?: string };
        throw new Error(failure.message ?? failure.detail ?? 'Sign-in failed. Check your details and try again.');
      }
      const successful = result as LoginResult;
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
        <h1>Welcome back.</h1>
        <p className="auth-intro">Sign in to your dealership workspace to manage sales, servicing and customer care.</p>
        <form onSubmit={submit} className="auth-form">
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
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'} <span>→</span></button>
        </form>
        <div className="auth-footnote"><span className="secure-mark">✓</span> Access is protected by your assigned dealership role.</div>
      </section>
      <div className="auth-footer">Powered by QuantaEdge <span>·</span> Smarter Decisions. Greater Growth.</div>
    </main>
  );
}

export type { LoginResult, StaffSummary };
