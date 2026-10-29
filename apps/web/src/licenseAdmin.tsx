import { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { apiRequestUrl } from './apiClient';
import './licenseAdmin.css';

type LicenseEntry = {
  dealershipCode: string;
  dealershipName: string;
  planCode: string | null;
  licenseStatus: string;
  state: string;
  startsAt: string | null;
  expiresAt: string | null;
  gracePeriodEndsAt: string | null;
  gracePeriodDays: number;
  maxStaffSeats: number;
  occupiedStaffSeats: number;
  daysUntilExpiry: number;
  message: string;
};

type LicenseForm = {
  dealershipCode: string;
  planCode: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  startsAt: string;
  expiresAt: string;
  gracePeriodDays: number;
  maxStaffSeats: number;
  reason: string;
};

function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

function makeForm(entry: LicenseEntry): LicenseForm {
  return {
    dealershipCode: entry.dealershipCode,
    planCode: entry.planCode ?? 'STANDARD',
    status: entry.licenseStatus === 'SUSPENDED' || entry.licenseStatus === 'REVOKED'
      ? entry.licenseStatus
      : 'ACTIVE',
    startsAt: toLocalDateTime(entry.startsAt),
    expiresAt: toLocalDateTime(entry.expiresAt),
    gracePeriodDays: entry.gracePeriodDays,
    maxStaffSeats: entry.maxStaffSeats,
    reason: '',
  };
}

function friendlyError(response: Response): string {
  if (response.status === 401 || response.status === 403) {
    return 'The licensing administrator token is invalid or was not accepted.';
  }
  if (response.status === 503) {
    return 'Licensing administration is not configured. Set APP_LICENSE_ADMIN_TOKEN as a secret on the API service.';
  }
  return 'The request failed (HTTP ' + response.status + '). Check the API and try again.';
}

function LicenseAdminApp() {
  const [token, setToken] = useState('');
  const [licenses, setLicenses] = useState<LicenseEntry[]>([]);
  const [form, setForm] = useState<LicenseForm | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');
  const [busy, setBusy] = useState(false);

  async function loadLicenses(event?: FormEvent) {
    event?.preventDefault();
    if (!token.trim()) {
      setMessage('Enter the vendor-only licensing token configured on the API.');
      setMessageType('error');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(apiRequestUrl('/api/v1/system/license/admin/licenses'), {
        headers: { Accept: 'application/json', 'X-License-Admin-Token': token.trim() },
      });
      if (!response.ok) throw new Error(friendlyError(response));
      const result = await response.json() as LicenseEntry[];
      setLicenses(result);
      setMessage('Connected securely. The token is held only in this page until it is closed or refreshed.');
      setMessageType('success');
    } catch (error) {
      setLicenses([]);
      setForm(null);
      setMessage(error instanceof Error ? error.message : 'Unable to load license records.');
      setMessageType('error');
    } finally {
      setBusy(false);
    }
  }

  function chooseLicense(entry: LicenseEntry) {
    setForm(makeForm(entry));
    setMessage('');
  }

  async function saveLicense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    if (!form.startsAt || !form.expiresAt || new Date(form.expiresAt) <= new Date(form.startsAt)) {
      setMessage('Expiry must be later than the license start date.');
      setMessageType('error');
      return;
    }
    if (form.reason.trim().length < 4) {
      setMessage('Enter a meaningful reason for this license change (at least four characters).');
      setMessageType('error');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(apiRequestUrl(
        '/api/v1/system/license/admin/licenses/' + encodeURIComponent(form.dealershipCode),
      ), {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-License-Admin-Token': token.trim(),
        },
        body: JSON.stringify({
          planCode: form.planCode,
          status: form.status,
          startsAt: toIso(form.startsAt),
          expiresAt: toIso(form.expiresAt),
          gracePeriodDays: Number(form.gracePeriodDays),
          maxStaffSeats: Number(form.maxStaffSeats),
          reason: form.reason.trim(),
        }),
      });
      if (!response.ok) throw new Error(friendlyError(response));
      const updated = await response.json() as LicenseEntry;
      setLicenses((current) => current.map((entry) =>
        entry.dealershipCode === updated.dealershipCode ? updated : entry));
      setForm(makeForm(updated));
      setMessage('License settings saved and recorded in the dealership audit trail.');
      setMessageType('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save license settings.');
      setMessageType('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="license-admin-shell">
      <header className="license-admin-header">
        <div className="license-brand-mark">Q</div>
        <div>
          <p className="license-eyebrow">QUANTAEDGE • RESTRICTED ADMINISTRATION</p>
          <h1>License control</h1>
          <p>Manage dealership software access, expiry, grace periods and licensed staff seats.</p>
        </div>
      </header>

      <section className="license-admin-connect">
        <form onSubmit={(event) => void loadLicenses(event)}>
          <label htmlFor="license-admin-token">Vendor licensing token</label>
          <div className="license-token-row">
            <input
              id="license-admin-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Enter the API deployment secret"
            />
            <button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect securely'}</button>
          </div>
          <small>The token is never saved in browser storage. Use HTTPS and clear it by closing or refreshing this page.</small>
        </form>
      </section>

      {message && <div className={'license-admin-message license-admin-message--' + messageType} role="status">{message}</div>}

      <div className="license-admin-grid">
        <section className="license-panel">
          <div className="license-panel-heading">
            <div><p className="license-eyebrow">DEALERSHIPS</p><h2>License records</h2></div>
            <span className="license-count">{licenses.length}</span>
          </div>
          {licenses.length === 0 ? (
            <p className="license-empty">Connect with the administrator token to load existing dealership license records.</p>
          ) : (
            <div className="license-record-list">
              {licenses.map((entry) => (
                <button
                  type="button"
                  key={entry.dealershipCode}
                  className={'license-record' + (form?.dealershipCode === entry.dealershipCode ? ' license-record--selected' : '')}
                  onClick={() => chooseLicense(entry)}
                >
                  <span className="license-record-top">
                    <strong>{entry.dealershipName}</strong>
                    <span className={'license-state license-state--' + entry.state.toLowerCase().replaceAll('_', '-')}>{entry.state.replaceAll('_', ' ')}</span>
                  </span>
                  <span className="license-record-meta">{entry.dealershipCode} · {entry.planCode ?? 'No plan'}</span>
                  <span className="license-record-meta">
                    {entry.occupiedStaffSeats} of {entry.maxStaffSeats} staff seats ·
                    {entry.expiresAt ? ' expires ' + new Date(entry.expiresAt).toLocaleDateString() : ' no expiry configured'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="license-panel">
          <div className="license-panel-heading">
            <div><p className="license-eyebrow">LICENSE TERMS</p><h2>{form ? form.dealershipCode : 'Select a dealership'}</h2></div>
          </div>
          {!form ? (
            <p className="license-empty">Choose a license record to update its plan, expiry, grace period, status or seat limit.</p>
          ) : (
            <form className="license-edit-form" onSubmit={(event) => void saveLicense(event)}>
              <label>Plan code
                <input required minLength={2} maxLength={80} value={form.planCode}
                  onChange={(event) => setForm({ ...form, planCode: event.target.value.toUpperCase() })}/>
              </label>
              <label>License status
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as LicenseForm['status'] })}>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="REVOKED">Revoked</option>
                </select>
              </label>
              <div className="license-form-two">
                <label>Starts at
                  <input type="datetime-local" required value={form.startsAt}
                    onChange={(event) => setForm({ ...form, startsAt: event.target.value })}/>
                </label>
                <label>Expires at
                  <input type="datetime-local" required value={form.expiresAt}
                    onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}/>
                </label>
              </div>
              <div className="license-form-two">
                <label>Grace period (days)
                  <input type="number" required min={0} max={90} value={form.gracePeriodDays}
                    onChange={(event) => setForm({ ...form, gracePeriodDays: Number(event.target.value) })}/>
                </label>
                <label>Maximum staff seats
                  <input type="number" required min={1} max={1000} value={form.maxStaffSeats}
                    onChange={(event) => setForm({ ...form, maxStaffSeats: Number(event.target.value) })}/>
                </label>
              </div>
              <label>Reason for change
                <textarea required minLength={4} maxLength={500} rows={3} value={form.reason}
                  onChange={(event) => setForm({ ...form, reason: event.target.value })}
                  placeholder="For example, subscription renewed through 30 November 2026"/>
              </label>
              <p className="license-form-help">Expired licenses retain read-only access and permitted exports after grace. Suspended and revoked licenses block operational data access. Changes are audited.</p>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save license settings'}</button>
            </form>
          )}
        </section>
      </div>

      <footer className="license-admin-footer">Keep this page private. Never put the licensing token in source control, screenshots, URL parameters or normal staff credentials.</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<LicenseAdminApp />);
