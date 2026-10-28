import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../apiClient';
import type { StaffSummary } from '../auth/StaffLogin';

type Customer = {
  publicId: string;
  customerCode: string;
  fullName: string;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  preferredLanguage: 'hi' | 'en' | 'hinglish';
  status: string;
  createdAt: string;
  updatedAt: string;
};

type CustomerPage = { items: Customer[]; page: number; pageSize: number; total: number };
type PortalInvitation = {
  customerPublicId: string;
  customerName: string;
  purpose: 'SETUP' | 'PASSWORD_RESET';
  activationToken: string;
  expiresAt: string;
};
type CustomerForm = {
  fullName: string;
  phone: string;
  alternatePhone: string;
  email: string;
  preferredLanguage: 'hi' | 'en' | 'hinglish';
  marketingConsent: boolean;
  consentSource: string;
  notes: string;
};

const emptyForm: CustomerForm = {
  fullName: '', phone: '', alternatePhone: '', email: '', preferredLanguage: 'hi',
  marketingConsent: false, consentSource: '', notes: '',
};

export default function CustomerWorkspace({
  token, staff,
}: { token: string; staff: StaffSummary }) {
  const [page, setPage] = useState<CustomerPage>({ items: [], page: 0, pageSize: 25, total: 0 });
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [portalInvitation, setPortalInvitation] = useState<PortalInvitation | null>(null);
  const [portalInvitationBusyId, setPortalInvitationBusyId] = useState('');
  const [portalTokenCopied, setPortalTokenCopied] = useState(false);

  const canCreate = staff.permissions.includes('customer.create');
  const canRead = staff.permissions.includes('customer.read');
  const canUpdate = staff.permissions.includes('customer.update');

  const load = useCallback(async (pageNumber: number, search: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(pageNumber), pageSize: '25' });
      if (search.trim()) params.set('q', search.trim());
      const result = await apiFetch<CustomerPage>(`/api/v1/admin/customers?${params.toString()}`, token);
      setPage(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load customer records.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load(0, '');
  }, [load]);

  function update<K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await apiFetch<Customer>('/api/v1/admin/customers', token, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          phone: form.phone.trim() || null,
          alternatePhone: form.alternatePhone.trim() || null,
          email: form.email.trim() || null,
          consentSource: form.marketingConsent ? form.consentSource.trim() : null,
          notes: form.notes.trim() || null,
        }),
      });
      setForm(emptyForm);
      setShowCreate(false);
      setActiveQuery('');
      setQuery('');
      setSuccess('Customer created. The customer list has been refreshed.');
      await load(0, '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the customer.');
    } finally {
      setSaving(false);
    }
  }

  async function issuePortalInvitation(customer: Customer) {
    setPortalInvitationBusyId(customer.publicId);
    setPortalInvitation(null);
    setPortalTokenCopied(false);
    setError('');
    setSuccess('');
    try {
      const invitation = await apiFetch<PortalInvitation>(
        `/api/v1/admin/customers/${customer.publicId}/portal-invitation`, token, { method: 'POST' });
      setPortalInvitation(invitation);
      setSuccess(invitation.purpose === 'SETUP'
        ? `A customer portal invitation was issued for ${customer.fullName}.`
        : `A password-reset invitation was issued for ${customer.fullName}. Existing sessions are revoked when reset completes.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Customer portal invitation could not be issued.');
    } finally {
      setPortalInvitationBusyId('');
    }
  }

  async function copyInvitationToken() {
    if (!portalInvitation) return;
    try {
      await navigator.clipboard.writeText(portalInvitation.activationToken);
      setPortalTokenCopied(true);
    } catch {
      setPortalTokenCopied(false);
      setError('Clipboard access is unavailable. Select and copy the invitation token manually.');
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim();
    setActiveQuery(next);
    void load(0, next);
  }

  const firstRecord = page.total === 0 ? 0 : page.page * page.pageSize + 1;
  const lastRecord = Math.min((page.page + 1) * page.pageSize, page.total);

  if (!canRead) {
    return <section className="module-landing"><div className="module-symbol">◎</div><div className="eyebrow">ACCESS CONTROL</div><h1>Customers</h1><p>Your assigned role does not include access to customer records.</p></section>;
  }

  return (
    <section className="customer-workspace">
      <div className="customer-page-heading">
        <div>
          <div className="eyebrow">CUSTOMER RELATIONSHIP MANAGEMENT</div>
          <h1>Customers</h1>
          <p>One reliable record for each customer and their dealership journey.</p>
        </div>
        {canCreate && <button className="primary-button" type="button" onClick={() => { setShowCreate((value) => !value); setError(''); setSuccess(''); }}>
          {showCreate ? 'Close form' : '+ Add customer'}
        </button>}
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {success && <div className="notice notice-success" role="status">{success}</div>}

      {showCreate && canCreate && (
        <form className="customer-form-card" onSubmit={createCustomer}>
          <div className="form-card-heading"><div><h2>New customer</h2><p>Phone or email is required. Marketing consent is optional and recorded separately.</p></div><span className="form-step">01 / CUSTOMER</span></div>
          <div className="customer-form-grid">
            <label className="field-span-two">Full name *
              <input required minLength={2} maxLength={160} value={form.fullName} onChange={(event) => update('fullName', event.target.value)} placeholder="Customer's full name" />
            </label>
            <label>Mobile number
              <input type="tel" maxLength={32} value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="+91…" />
            </label>
            <label>Alternate number
              <input type="tel" maxLength={32} value={form.alternatePhone} onChange={(event) => update('alternatePhone', event.target.value)} placeholder="Optional" />
            </label>
            <label>Email address
              <input type="email" maxLength={320} value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="name@example.com" />
            </label>
            <label>Preferred language
              <select value={form.preferredLanguage} onChange={(event) => update('preferredLanguage', event.target.value as CustomerForm['preferredLanguage'])}>
                <option value="hi">हिन्दी</option><option value="en">English</option><option value="hinglish">Hinglish</option>
              </select>
            </label>
            <label className="field-span-two">Internal note <span className="optional-label">Optional</span>
              <textarea maxLength={3000} rows={2} value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Information needed for service and sales follow-up" />
            </label>
            <div className="field-span-two consent-panel">
              <label className="consent-check"><input type="checkbox" checked={form.marketingConsent} onChange={(event) => update('marketingConsent', event.target.checked)} /> <span>Customer has explicitly agreed to receive marketing messages.</span></label>
              <p>Service updates and marketing messages are different. Only record marketing consent when it has actually been given.</p>
              {form.marketingConsent && <label>Consent source *
                <input required maxLength={80} value={form.consentSource} onChange={(event) => update('consentSource', event.target.value)} placeholder="For example, signed form or recorded opt-in" />
              </label>}
            </div>
          </div>
          <div className="form-actions"><button className="secondary-button" type="button" onClick={() => { setShowCreate(false); setForm(emptyForm); }}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving customer…' : 'Save customer'}</button></div>
        </form>
      )}

      <div className="customer-table-card">
        <div className="table-toolbar">
          <div><h2>Customer directory</h2><p>{page.total.toLocaleString('en-IN')} records in this dealership</p></div>
          <form className="search-form" onSubmit={search}>
            <label className="sr-only" htmlFor="customer-search">Search customers</label>
            <input id="customer-search" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} placeholder="Name, mobile, code or email" />
            <button type="submit" className="secondary-button">Search</button>
            {activeQuery && <button type="button" className="text-button" onClick={() => { setQuery(''); setActiveQuery(''); void load(0, ''); }}>Clear</button>}
          </form>
        </div>

        <div className="customer-table-scroll">
          <table className="customer-table">
            <thead><tr><th>Customer</th><th>Contact</th><th>Language</th><th>Status</th><th>Added</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="table-empty"><span className="loading-dot" /> Loading customer records…</td></tr>
                : page.items.length === 0 ? <tr><td colSpan={5} className="table-empty">{activeQuery ? 'No customers match this search.' : 'No customers yet. Add the first customer to begin.'}</td></tr>
                : page.items.map((customer) => (
                  <tr key={customer.publicId}>
                    <td><div className="customer-name-cell"><span className="customer-initial">{customer.fullName.trim().slice(0, 1).toUpperCase()}</span><div><strong>{customer.fullName}</strong><span>{customer.customerCode}</span></div></div></td>
                    <td><div className="contact-cell">{customer.phone && <span>{customer.phone}</span>}{customer.email && <span>{customer.email}</span>}{!customer.phone && !customer.email && <span>—</span>}</div></td>
                    <td><span className="language-chip">{customer.preferredLanguage === 'hi' ? 'हिन्दी' : customer.preferredLanguage === 'en' ? 'English' : 'Hinglish'}</span></td>
                    <td><span className={customer.status === 'ACTIVE' ? 'status-chip status-active' : 'status-chip'}>{customer.status}</span></td>
                    <td className="date-cell">{new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(customer.createdAt))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>{page.total ? `Showing ${firstRecord}–${lastRecord} of ${page.total}` : 'No records to display'}</span>
          <div className="pagination">
            <button type="button" className="pagination-button" disabled={loading || page.page <= 0} onClick={() => void load(page.page - 1, activeQuery)}>← Previous</button>
            <span>Page {page.page + 1}</span>
            <button type="button" className="pagination-button" disabled={loading || (page.page + 1) * page.pageSize >= page.total} onClick={() => void load(page.page + 1, activeQuery)}>Next →</button>
          </div>
        </div>
      </div>
    </section>
  );
}
