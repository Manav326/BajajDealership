import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch, apiRequestUrl } from '../apiClient';
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
type CustomerAddress = {
  publicId: string;
  label: 'HOME' | 'WORK' | 'OTHER';
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  locality: string | null;
  city: string;
  district: string | null;
  state: string;
  postalCode: string;
  country: string;
  isDefaultDelivery: boolean;
  createdAt: string;
  updatedAt: string;
};


type CustomerMotorcyclePurchase = {
  publicId: string; invoiceNumber: string; modelName: string; variantName: string | null; colourName: string | null;
  modelYear: number | null; invoiceTotal: number; paidAmount: number; creditedAmount: number; balanceDue: number;
  invoiceIssuedAt: string | null; deliveredAt: string; deliveredToName: string;
};
type CustomerPartOrderHistory = {
  publicId: string; orderCode: string; status: string; paymentMethod: string; paymentStatus: string; orderTotal: number;
  fulfillmentMethod: string; deliveryAddress: string | null; deliveryFee: number | null; deliveryQuoteStatus: string | null;
  deliveryQuoteNote: string | null; deliveryQuotedAt: string | null; customerNote: string | null; createdAt: string;
  updatedAt: string; cancelledAt: string | null; fulfilledAt: string | null; returnedAt: string | null;
  returnReason: string | null; restockedOnReturn: boolean | null; customerName: string; customerCode: string;
  customerPhone: string | null; lines: Array<{ partPublicId: string; skuCode: string; partName: string;
    unitOfMeasure: string; quantity: number; unitPrice: number; lineTotal: number }>;
};
type CustomerWebsiteRequestHistory = {
  publicId: string; requestCode: string; requestType: string; modelCode: string; modelName: string;
  preferredAt: string | null; notes: string | null; status: string; createdAt: string; updatedAt: string;
  convertedEnquiryPublicId: string | null; customerPublicId: string; customerCode: string; customerName: string;
  customerPhone: string | null; customerEmail: string | null; enquiryCode: string | null; enquiryStatus: string | null;
  testRideCode: string | null; testRideStatus: string | null; testRideScheduledStart: string | null;
  bookingCode: string | null; bookingStatus: string | null; invoiceNumber: string | null; invoiceStatus: string | null;
  invoiceTotal: number | null; paidAmount: number; creditedAmount: number | null; balanceDue: number | null; deliveredAt: string | null;
};
type CustomerHistory = {
  customer: Customer; notes: string | null; marketingConsentAt: string | null; marketingConsentSource: string | null;
  motorcyclePurchases: CustomerMotorcyclePurchase[]; sparePartOrders: CustomerPartOrderHistory[];
  websiteRequests: CustomerWebsiteRequestHistory[];
};
function formatCustomerHistoryMoney(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value ?? 0));
}
function formatCustomerHistoryDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

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
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedAddresses, setSelectedAddresses] = useState<CustomerAddress[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<CustomerHistory | null>(null);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState('');
  const [selectedProfileLoading, setSelectedProfileLoading] = useState(false);
  const [selectedProfileError, setSelectedProfileError] = useState('');
  const selectedProfileRequestId = useRef(0);

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


  async function openCustomerProfile(customer: Customer) {
    const requestId = ++selectedProfileRequestId.current;
    if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
    setSelectedPhotoUrl('');
    setSelectedCustomer(customer);
    setSelectedAddresses([]);
    setSelectedHistory(null);
    setSelectedProfileError('');
    setSelectedProfileLoading(true);

    // A history failure must not block the customer profile or saved address book.
    try {
      const [detail, addresses] = await Promise.all([
        apiFetch<Customer>('/api/v1/admin/customers/' + customer.publicId, token),
        apiFetch<CustomerAddress[]>('/api/v1/admin/customers/' + customer.publicId + '/saved-addresses', token),
      ]);
      if (requestId !== selectedProfileRequestId.current) return;
      setSelectedCustomer(detail);
      setSelectedAddresses(Array.isArray(addresses) ? addresses : []);
    } catch (cause) {
      if (requestId === selectedProfileRequestId.current) {
        setSelectedProfileError(cause instanceof Error
          ? cause.message
          : 'Customer profile details could not be loaded.');
        setSelectedProfileLoading(false);
      }
      return;
    }

    try {
      const history = await apiFetch<CustomerHistory>(
        '/api/v1/admin/customers/' + customer.publicId + '/history', token);
      if (requestId === selectedProfileRequestId.current) setSelectedHistory(history);
    } catch (cause) {
      if (requestId === selectedProfileRequestId.current) {
        setSelectedProfileError(
          'Profile and saved addresses loaded, but purchase history could not be loaded. ' +
          (cause instanceof Error ? cause.message : 'Close and reopen this profile to retry.'));
      }
    }

    try {
      const response = await fetch(apiRequestUrl('/api/v1/admin/customers/' + customer.publicId + '/profile-photo'), {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (response.ok) {
        const url = URL.createObjectURL(await response.blob());
        if (requestId === selectedProfileRequestId.current) setSelectedPhotoUrl(url);
        else URL.revokeObjectURL(url);
      }
    } catch {
      // The initials avatar remains a safe fallback if the private photo is temporarily unavailable.
    } finally {
      if (requestId === selectedProfileRequestId.current) setSelectedProfileLoading(false);
    }
  }

  function closeCustomerProfile() {
    selectedProfileRequestId.current += 1;
    if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
    setSelectedPhotoUrl('');
    setSelectedCustomer(null);
    setSelectedAddresses([]);
    setSelectedHistory(null);
    setSelectedProfileError('');
    setSelectedProfileLoading(false);
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
      {portalInvitation && <section className="customer-form-card portal-invitation-card" aria-label="Customer portal invitation">
        <div className="form-card-heading"><div><h2>{portalInvitation.purpose === 'SETUP' ? 'Customer portal invitation' : 'Password reset invitation'}</h2><p>For {portalInvitation.customerName}. The token is shown once here and is not sent by SMS or email.</p></div><button type="button" className="text-button" onClick={() => { setPortalInvitation(null); setPortalTokenCopied(false); }}>Dismiss</button></div>
        <div className="portal-invitation-warning"><strong>Share securely</strong><span>Verify the customer's identity and deliver this one-time token directly. It expires {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(portalInvitation.expiresAt))}. Issuing another invitation invalidates the previous unused invitation.</span></div>
        <label className="portal-token-label">One-time invitation token<input readOnly value={portalInvitation.activationToken} onFocus={(event) => event.currentTarget.select()} aria-label="One-time customer portal invitation token" /></label>
        <div className="portal-invitation-actions"><button type="button" className="secondary-button" onClick={() => void copyInvitationToken()}>{portalTokenCopied ? 'Copied token ✓' : 'Copy token'}</button><span>Customer activates the account at the customer portal website.</span></div>
      </section>}

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
            <thead><tr><th>Customer</th><th>Contact</th><th>Language</th><th>Status</th><th>Added</th><th>Profile</th>{canUpdate && <th>Portal access</th>}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={canUpdate ? 7 : 6} className="table-empty"><span className="loading-dot" /> Loading customer records…</td></tr>
                : page.items.length === 0 ? <tr><td colSpan={canUpdate ? 7 : 6} className="table-empty">{activeQuery ? 'No customers match this search.' : 'No customers yet. Add the first customer to begin.'}</td></tr>
                : page.items.map((customer) => (
                  <tr key={customer.publicId}>
                    <td><div className="customer-name-cell"><span className="customer-initial" aria-hidden="true">{customer.fullName.trim().slice(0, 1).toUpperCase()}</span><div><strong>{customer.fullName}</strong><span>{customer.customerCode}</span></div></div></td>
                    <td><div className="contact-cell">{customer.phone && <span>{customer.phone}</span>}{customer.email && <span>{customer.email}</span>}{!customer.phone && !customer.email && <span>—</span>}</div></td>
                    <td><span className="language-chip">{customer.preferredLanguage === 'hi' ? 'हिन्दी' : customer.preferredLanguage === 'en' ? 'English' : 'Hinglish'}</span></td>
                    <td><span className={customer.status === 'ACTIVE' ? 'status-chip status-active' : 'status-chip'}>{customer.status}</span></td>
                    <td className="date-cell">{new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(customer.createdAt))}</td>
                    <td><button type="button" className="customer-profile-open" onClick={() => void openCustomerProfile(customer)} aria-label={`View profile for ${customer.fullName}`}>View profile <span aria-hidden="true">↗</span></button></td>
                    {canUpdate && <td><button type="button" className="text-button portal-invite-button" disabled={portalInvitationBusyId === customer.publicId || customer.status !== 'ACTIVE'} onClick={() => void issuePortalInvitation(customer)}>{portalInvitationBusyId === customer.publicId ? 'Issuing…' : 'Issue access'}</button></td>}
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

      {selectedCustomer && <div className="customer-profile-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeCustomerProfile();
      }}>
        <section className="customer-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-profile-title">
          <div className="customer-profile-dialog-head">
            <div><div className="eyebrow">CUSTOMER RECORD</div><h2 id="customer-profile-title">Customer profile</h2><p>Contact details and saved delivery destinations for dealership service.</p></div>
            <button type="button" className="customer-profile-close" onClick={closeCustomerProfile} aria-label="Close customer profile">×</button>
          </div>
          {selectedProfileError && <div className="notice notice-error" role="alert">{selectedProfileError}</div>}
          {selectedProfileLoading ? <div className="customer-profile-loading"><span className="loading-dot" /> Loading customer profile…</div> : <>
            <div className="customer-profile-summary">
              <div className="customer-profile-photo">{selectedPhotoUrl
                ? <img src={selectedPhotoUrl} alt={selectedCustomer.fullName + ' profile photo'} />
                : <span>{selectedCustomer.fullName.trim().slice(0, 1).toUpperCase()}</span>}</div>
              <div className="customer-profile-summary-main"><span className="customer-profile-code">{selectedCustomer.customerCode} · {selectedCustomer.status}</span><h3>{selectedCustomer.fullName}</h3>
                <div className="customer-profile-contact">{selectedCustomer.phone && <span>Mobile · {selectedCustomer.phone}</span>}{selectedCustomer.alternatePhone && <span>Alternate · {selectedCustomer.alternatePhone}</span>}{selectedCustomer.email && <span>Email · {selectedCustomer.email}</span>}</div>
                <span className="language-chip">{selectedCustomer.preferredLanguage === 'hi' ? 'हिन्दी' : selectedCustomer.preferredLanguage === 'en' ? 'English' : 'Hinglish'}</span>
              </div>
            </div>
            <div className="customer-profile-address-heading"><div><h3>Saved addresses</h3><p>Customer-managed addresses for delivery and contact.</p></div><span>{selectedAddresses.length} saved</span></div>
            {selectedAddresses.length === 0 ? <div className="customer-profile-address-empty">No saved addresses have been added to the customer portal yet. Confirm the destination with the customer before arranging delivery.</div>
              : <div className="customer-profile-address-grid">{selectedAddresses.map((address) => <article className="customer-profile-address" key={address.publicId}>
                  <div className="customer-profile-address-top"><span className="customer-profile-address-icon">{address.label === 'HOME' ? '⌂' : address.label === 'WORK' ? '▦' : '⌖'}</span><div><span>{address.label}</span><strong>{address.recipientName}</strong></div>{address.isDefaultDelivery && <span className="customer-profile-default">Default</span>}</div>
                  <p>{[address.addressLine1, address.addressLine2, address.landmark ? 'Near ' + address.landmark : null,
                    address.locality, address.city, address.district, address.state, address.postalCode, address.country]
                    .filter((part): part is string => Boolean(part && part.trim())).join(', ')}</p>
                  <small>Contact at this address: {address.phone}</small>
                </article>)}</div>}

            <div className="customer-profile-history">
              <section className="customer-profile-history-section">
                <div className="customer-profile-address-heading"><div><h3>Motorcycles purchased</h3><p>Completed and acknowledged vehicle handovers, including in-store purchases.</p></div><span>{selectedHistory?.motorcyclePurchases.length ?? 0}</span></div>
                {!selectedHistory
                  ? <div className="customer-profile-address-empty">Motorcycle purchase history could not be loaded. The profile remains available; reopen it to retry.</div>
                  : selectedHistory.motorcyclePurchases.length === 0
                    ? <div className="customer-profile-address-empty">No completed motorcycle handovers are linked to this customer yet. Current enquiries and bookings are shown below.</div>
                  : <div className="customer-history-list">{selectedHistory.motorcyclePurchases.map((purchase) => <article className="customer-history-record" key={purchase.publicId}>
                    <span className="customer-history-record-icon motorcycle-history-icon">B</span>
                    <div className="customer-history-record-main"><div className="customer-history-title"><strong>{purchase.modelName}{purchase.variantName ? ' · ' + purchase.variantName : ''}</strong><span className="customer-history-status">DELIVERED</span></div>
                      <p>{[purchase.colourName, purchase.modelYear ? String(purchase.modelYear) : null].filter(Boolean).join(' · ') || 'Bajaj motorcycle'} · Invoice {purchase.invoiceNumber}</p>
                      <small>Delivered {formatCustomerHistoryDate(purchase.deliveredAt)} · Acknowledged by {purchase.deliveredToName}</small></div>
                    <div className="customer-history-money"><strong>{formatCustomerHistoryMoney(purchase.invoiceTotal)}</strong><span>Paid {formatCustomerHistoryMoney(purchase.paidAmount)}</span>{purchase.creditedAmount > 0 && <span>Credits {formatCustomerHistoryMoney(purchase.creditedAmount)}</span>}<span>Balance {formatCustomerHistoryMoney(purchase.balanceDue)}</span></div>
                  </article>)}</div>}
              </section>
              <section className="customer-profile-history-section">
                <div className="customer-profile-address-heading"><div><h3>Spare-parts orders & returns</h3><p>Full saved order history with cancellation, collection, delivery and return states.</p></div><span>{selectedHistory?.sparePartOrders.length ?? 0}</span></div>
                {!selectedHistory
                  ? <div className="customer-profile-address-empty">Spare-parts order history could not be loaded. Reopen the profile to retry.</div>
                  : selectedHistory.sparePartOrders.length === 0
                    ? <div className="customer-profile-address-empty">No spare-parts orders recorded for this customer.</div>
                  : <div className="customer-history-list">{selectedHistory.sparePartOrders.map((order) => <article className="customer-history-record" key={order.publicId}>
                    <span className="customer-history-record-icon parts-history-icon">P</span>
                    <div className="customer-history-record-main"><div className="customer-history-title"><strong>{order.orderCode}</strong><span className="customer-history-status">{order.status.replaceAll('_',' ')}</span></div>
                      <p>{order.lines.map((line) => line.quantity + ' × ' + line.partName + ' (' + line.skuCode + ')').join(' · ')}</p>
                      <small>Placed {formatCustomerHistoryDate(order.createdAt)} · {order.fulfillmentMethod === 'PICKUP' ? 'Pickup' : 'Delivery'} · {order.paymentStatus.replaceAll('_',' ')}</small>
                      {order.deliveryAddress && <small>Delivery address snapshot: {order.deliveryAddress}</small>}
                      {order.deliveryFee != null && Number(order.deliveryFee) > 0 && <small>Delivery fee {formatCustomerHistoryMoney(order.deliveryFee)}{order.deliveryQuoteStatus ? ' · ' + order.deliveryQuoteStatus.replaceAll('_',' ') : ''}</small>}
                      {order.returnReason && <small>Return reason: {order.returnReason}{order.restockedOnReturn ? ' · Restocked after inspection' : ' · Not returned to sellable stock'}</small>}
                      {order.customerNote && <small>Customer note: {order.customerNote}</small>}</div>
                    <div className="customer-history-money"><strong>{formatCustomerHistoryMoney(order.orderTotal)}</strong><span>{order.status === 'FULFILLED' ? 'Fulfilled ' + formatCustomerHistoryDate(order.fulfilledAt) : order.status === 'RETURNED' ? 'Returned ' + formatCustomerHistoryDate(order.returnedAt) : order.status === 'CANCELLED' ? 'Cancelled ' + formatCustomerHistoryDate(order.cancelledAt) : 'Updated ' + formatCustomerHistoryDate(order.updatedAt)}</span></div>
                  </article>)}</div>}
              </section>
              <section className="customer-profile-history-section">
                <div className="customer-profile-address-heading"><div><h3>Bike enquiries & test rides</h3><p>Website requests retained after conversion, booking, cancellation or delivery.</p></div><span>{selectedHistory?.websiteRequests.length ?? 0}</span></div>
                {!selectedHistory
                  ? <div className="customer-profile-address-empty">Website enquiries and test-ride history could not be loaded. Reopen the profile to retry.</div>
                  : selectedHistory.websiteRequests.length === 0
                    ? <div className="customer-profile-address-empty">No website-originated bike requests are recorded for this customer.</div>
                  : <div className="customer-history-list">{selectedHistory.websiteRequests.map((request) => <article className="customer-history-record" key={request.publicId}>
                    <span className="customer-history-record-icon request-history-icon">{request.requestType === 'TEST_RIDE' ? 'T' : 'E'}</span>
                    <div className="customer-history-record-main"><div className="customer-history-title"><strong>{request.modelName}</strong><span className="customer-history-status">{request.status.replaceAll('_',' ')}</span></div>
                      <p>{request.requestCode} · {request.requestType === 'TEST_RIDE' ? 'Test ride' : 'Purchase enquiry'} · Created {formatCustomerHistoryDate(request.createdAt)}</p>
                      {request.preferredAt && <small>Preferred time {formatCustomerHistoryDate(request.preferredAt)}</small>}
                      {request.enquiryCode && <small>Sales enquiry {request.enquiryCode} · {request.enquiryStatus}</small>}
                      {request.testRideCode && <small>Test ride {request.testRideCode} · {request.testRideStatus}{request.testRideScheduledStart ? ' · ' + formatCustomerHistoryDate(request.testRideScheduledStart) : ''}</small>}
                      {request.bookingCode && <small>Booking {request.bookingCode} · {request.bookingStatus}</small>}
                      {request.invoiceNumber && <small>Invoice {request.invoiceNumber} · {request.invoiceStatus} · Total {formatCustomerHistoryMoney(request.invoiceTotal)} · Balance {formatCustomerHistoryMoney(request.balanceDue)}</small>}
                      {request.notes && <small>Customer request note: {request.notes}</small>}</div>
                    {request.deliveredAt && <div className="customer-history-money"><span>Delivered {formatCustomerHistoryDate(request.deliveredAt)}</span></div>}
                  </article>)}</div>}
              </section>
              <section className="customer-profile-history-section customer-history-metadata">
                <div className="customer-profile-address-heading"><div><h3>Customer notes & consent</h3><p>Context for support and eligibility for marketing communications.</p></div></div>
                <p>{selectedHistory?.notes?.trim() || 'No internal customer note has been added.'}</p>
                <div><span className={selectedHistory?.marketingConsentAt ? 'customer-history-consent yes' : 'customer-history-consent'}>{selectedHistory?.marketingConsentAt ? 'Marketing consent recorded' : 'No marketing consent recorded'}</span>
                  {selectedHistory?.marketingConsentAt && <small> · {formatCustomerHistoryDate(selectedHistory.marketingConsentAt)} · Source: {selectedHistory.marketingConsentSource ?? 'Not recorded'}</small>}</div>
              </section>
            </div>
            <div className="customer-profile-dialog-footer"><span>Address book changes do not overwrite the delivery address saved on previous orders. Historic purchases and payment amounts are read from saved transaction records.</span><button type="button" className="primary-button" onClick={closeCustomerProfile}>Done</button></div>
          </>}
        </section>
      </div>}
    </section>
  );
}
