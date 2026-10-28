import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../apiClient';

type InvoiceCandidate = {
  sourceType: 'SALES' | 'WORKSHOP'; invoicePublicId: string; invoiceNumber: string; customerName: string;
  customerPhone: string | null; status: string; invoiceTotal: number | string; paidAmount: number | string;
  approvedCreditAmount: number | string; creditableRemaining: number | string;
};
type Adjustment = {
  publicId: string; adjustmentNumber: string; adjustmentType: 'CREDIT_NOTE' | 'REFUND';
  sourceType: 'SALES' | 'WORKSHOP'; invoicePublicId: string; invoiceNumber: string; customerName: string;
  parentAdjustmentPublicId: string | null; paymentPublicId: string | null; paymentReceiptNumber: string | null;
  amount: number | string; reason: string; status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PAID';
  createdByName: string; createdAt: string; reviewedByName: string | null; reviewedAt: string | null;
  reviewReason: string | null; paidByName: string | null; paidAt: string | null;
  paymentMethod: string | null; paymentReference: string | null;
};
type PaymentOption = {
  publicId: string; receiptNumber: string; paymentMethod: string; recordedAmount: number | string;
  refundableRemaining: number | string; recordedAt: string;
};
type HistoryEvent = {
  eventType: string; fromStatus: string | null; toStatus: string; reason: string; externalReference: string | null;
  actorName: string; createdAt: string;
};
type Props = { token: string; permissions: string[] };
const money = (value: number | string | undefined) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2,
}).format(Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0);
const dateLabel = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const newKey = () => crypto.randomUUID();
const statusLabel = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, x => x.toUpperCase());

export default function FinanceAdjustmentsWorkspace({ token, permissions }: Props) {
  const [invoices, setInvoices] = useState<InvoiceCandidate[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>([]);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [searchText, setSearchText] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [creditKey, setCreditKey] = useState(newKey);
  const [selectedCreditId, setSelectedCreditId] = useState('');
  const [selectedPaymentId, setSelectedPaymentId] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundKey, setRefundKey] = useState(newKey);
  const [payoutMethod, setPayoutMethod] = useState('BANK_TRANSFER');
  const [payoutReference, setPayoutReference] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [rejectingId, setRejectingId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [historyFor, setHistoryFor] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canCreate = permissions.includes('finance.invoice') || permissions.includes('finance.payment');
  const canReview = permissions.includes('finance.adjustment.approve');
  const canPayout = permissions.includes('finance.payment');
  const selectedInvoice = invoices.find(item => item.invoicePublicId === selectedInvoiceId);
  const approvedCreditNotes = useMemo(() => adjustments.filter(
    item => item.adjustmentType === 'CREDIT_NOTE' && item.status === 'APPROVED'), [adjustments]);
  const selectedCreditNote = approvedCreditNotes.find(item => item.publicId === selectedCreditId);
  const visibleAdjustments = useMemo(() => filter === 'ALL' ? adjustments
    : adjustments.filter(item => item.status === filter), [adjustments, filter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAdjustments(await apiFetch<Adjustment[]>('/api/v1/admin/finance/adjustments?status=ALL', token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Financial adjustments could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    setPaymentOptions([]);
    setSelectedPaymentId('');
    if (!selectedCreditNote) return;
    let active = true;
    void apiFetch<PaymentOption[]>('/api/v1/admin/finance/adjustments/' + selectedCreditNote.publicId + '/payment-options', token)
      .then(rows => { if (active) setPaymentOptions(rows); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Payment options could not be loaded.'); });
    return () => { active = false; };
  }, [selectedCreditNote?.publicId, token]);

  async function searchInvoices() {
    setSearching(true); setError('');
    try {
      const url = '/api/v1/admin/finance/adjustments/invoices' + (searchText.trim()
        ? '?q=' + encodeURIComponent(searchText.trim()) : '');
      const rows = await apiFetch<InvoiceCandidate[]>(url, token);
      setInvoices(rows);
      setSelectedInvoiceId(rows.some(row => row.invoicePublicId === selectedInvoiceId) ? selectedInvoiceId : '');
      if (!rows.length) setNotice('No issued invoices match that search.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Invoice search failed.');
    } finally { setSearching(false); }
  }

  async function createCreditNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInvoice) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const created = await apiFetch<Adjustment>('/api/v1/admin/finance/adjustments', token, {
        method: 'POST',
        body: JSON.stringify({
          adjustmentType: 'CREDIT_NOTE', sourceType: selectedInvoice.sourceType,
          invoicePublicId: selectedInvoice.invoicePublicId, amount: Number(creditAmount),
          reason: creditReason.trim(), idempotencyKey: creditKey,
        }),
      });
      setCreditAmount(''); setCreditReason(''); setCreditKey(newKey());
      setNotice('Credit adjustment ' + created.adjustmentNumber + ' entered the independent approval queue.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Credit adjustment could not be submitted.');
    } finally { setSaving(false); }
  }

  async function createRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCreditNote || !selectedPaymentId) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const created = await apiFetch<Adjustment>('/api/v1/admin/finance/adjustments', token, {
        method: 'POST',
        body: JSON.stringify({
          adjustmentType: 'REFUND', parentAdjustmentPublicId: selectedCreditNote.publicId,
          paymentPublicId: selectedPaymentId, amount: Number(refundAmount),
          reason: refundReason.trim(), idempotencyKey: refundKey,
        }),
      });
      setRefundAmount(''); setRefundReason(''); setRefundKey(newKey());
      setNotice('Refund request ' + created.adjustmentNumber + ' entered the independent approval queue.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Refund request could not be submitted.');
    } finally { setSaving(false); }
  }

  async function approve(publicId: string) {
    setSaving(true); setError(''); setNotice('');
    try {
      await apiFetch<Adjustment>('/api/v1/admin/finance/adjustments/' + publicId + '/approve', token, { method: 'POST' });
      setNotice('Adjustment approved. The decision and reviewer are now in the immutable event history.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Adjustment approval failed.');
    } finally { setSaving(false); }
  }

  async function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectingId) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await apiFetch<Adjustment>('/api/v1/admin/finance/adjustments/' + rejectingId + '/reject', token, {
        method: 'POST', body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      setNotice('Adjustment rejected; the reason was retained in its history.');
      setRejectingId(''); setRejectReason('');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Adjustment rejection failed.');
    } finally { setSaving(false); }
  }

  async function markPaid(publicId: string) {
    setSaving(true); setError(''); setNotice('');
    try {
      await apiFetch<Adjustment>('/api/v1/admin/finance/adjustments/' + publicId + '/mark-paid', token, {
        method: 'POST', body: JSON.stringify({ paymentMethod: payoutMethod, paymentReference: payoutReference.trim() || null }),
      });
      setPayoutReference('');
      setNotice('Payout attestation saved. This is not confirmation from a bank, UPI app or payment gateway.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Refund payout record could not be saved.');
    } finally { setSaving(false); }
  }

  async function showHistory(adjustment: Adjustment) {
    setError(''); setHistoryFor(adjustment.publicId);
    try {
      setEvents(await apiFetch<HistoryEvent[]>('/api/v1/admin/finance/adjustments/' + adjustment.publicId + '/history', token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Adjustment history could not be loaded.');
      setEvents([]);
    }
  }

  const referenceRequired = ['UPI', 'BANK_TRANSFER', 'CARD'].includes(payoutMethod);
  return <div className="finance-workspace">
    <section className="finance-header">
      <div><div className="finance-eyebrow">CONTROLLED FINANCIAL ADJUSTMENTS</div>
        <h1>Credit adjustments &amp; refunds</h1>
        <p>Record requests as separate transactions. Issued invoices and payment receipts are never silently edited or deleted.</p>
      </div>
    </section>
    <div className="finance-alert" role="note">
      These are operational credit adjustments, not statutory GST credit notes. Refund payout records are staff attestations only;
      no money is moved or verified through a payment provider by this screen.
    </div>
    {error && <div className="finance-alert finance-alert-error" role="alert">{error}</div>}
    {notice && <div className="finance-alert finance-alert-success" role="status">{notice}</div>}

    {canCreate && <section className="finance-panel">
      <div className="finance-section-heading"><div><h2>1. Request a credit adjustment</h2>
        <p>Search an issued sales or workshop invoice. The requested amount is reserved until the request is approved or rejected.</p></div></div>
      <div className="finance-report-filters">
        <label>Invoice / customer search<input value={searchText} maxLength={160} onChange={e => setSearchText(e.target.value)}
          placeholder="Invoice number, customer, phone or invoice ID" /></label>
        <button className="finance-primary-button" type="button" disabled={searching} onClick={() => void searchInvoices()}>
          {searching ? 'Searching…' : 'Search issued invoices'}
        </button>
      </div>
      {invoices.length > 0 && <div className="finance-table-scroll"><table className="finance-table">
        <thead><tr><th>Invoice</th><th>Customer</th><th>Gross total</th><th>Paid</th><th>Approved credits</th><th>Available credit</th><th>Select</th></tr></thead>
        <tbody>{invoices.map(invoice => <tr key={invoice.invoicePublicId}>
          <td><strong>{invoice.invoiceNumber}</strong><small>{invoice.sourceType === 'SALES' ? 'Vehicle sale' : 'Workshop'}</small></td>
          <td>{invoice.customerName}<small>{invoice.customerPhone || 'No phone on file'}</small></td>
          <td>{money(invoice.invoiceTotal)}</td><td>{money(invoice.paidAmount)}</td><td>{money(invoice.approvedCreditAmount)}</td>
          <td>{money(invoice.creditableRemaining)}</td>
          <td><button type="button" className="finance-small-button" onClick={() => setSelectedInvoiceId(invoice.invoicePublicId)}>
            {selectedInvoiceId === invoice.invoicePublicId ? 'Selected' : 'Select'}</button></td>
        </tr>)}</tbody></table></div>}
      <form className="finance-expense-form" onSubmit={event => void createCreditNote(event)}>
        <label>Selected invoice<input readOnly value={selectedInvoice
          ? selectedInvoice.invoiceNumber + ' · ' + selectedInvoice.customerName : 'Search and select an invoice first'} /></label>
        <label>Credit amount (₹)<input required type="number" min="0.01" step="0.01" value={creditAmount}
          max={selectedInvoice ? Number(selectedInvoice.creditableRemaining) : undefined}
          onChange={e => setCreditAmount(e.target.value)} /></label>
        <label>Reason<textarea required minLength={3} maxLength={500} rows={2} value={creditReason}
          onChange={e => setCreditReason(e.target.value)} placeholder="Explain the correction or commercial credit" /></label>
        <button className="finance-primary-button" type="submit" disabled={saving || !selectedInvoice ||
          Number(creditAmount) <= 0 || Number(creditAmount) > Number(selectedInvoice?.creditableRemaining ?? 0)}>
          {saving ? 'Submitting…' : 'Submit credit for approval'}
        </button>
      </form>
    </section>}

    {canCreate && <section className="finance-panel">
      <div className="finance-section-heading"><div><h2>2. Request a refund</h2>
        <p>Only approved credit adjustments and recorded payment receipts with remaining refundable amounts are eligible.</p></div></div>
      <form className="finance-expense-form" onSubmit={event => void createRefund(event)}>
        <label>Approved credit adjustment<select required value={selectedCreditId} onChange={e => setSelectedCreditId(e.target.value)}>
          <option value="">Select an approved credit</option>{approvedCreditNotes.map(note =>
            <option value={note.publicId} key={note.publicId}>{note.adjustmentNumber} · {note.invoiceNumber} · {money(note.amount)}</option>)}
        </select></label>
        <label>Recorded payment receipt<select required value={selectedPaymentId} onChange={e => setSelectedPaymentId(e.target.value)}>
          <option value="">Select a recorded receipt</option>{paymentOptions.map(payment =>
            <option value={payment.publicId} key={payment.publicId} disabled={Number(payment.refundableRemaining) <= 0}>
              {payment.receiptNumber} · {payment.paymentMethod.replaceAll('_', ' ')} · refundable {money(payment.refundableRemaining)}
            </option>)}
        </select></label>
        <label>Refund amount (₹)<input required type="number" min="0.01" step="0.01" value={refundAmount}
          max={selectedPaymentId ? Number(paymentOptions.find(p => p.publicId === selectedPaymentId)?.refundableRemaining ?? 0) : undefined}
          onChange={e => setRefundAmount(e.target.value)} /></label>
        <label>Reason<textarea required minLength={3} maxLength={500} rows={2} value={refundReason}
          onChange={e => setRefundReason(e.target.value)} placeholder="Explain the refund reason" /></label>
        <button className="finance-primary-button" type="submit" disabled={saving || !selectedCreditNote || !selectedPaymentId ||
          Number(refundAmount) <= 0 || Number(refundAmount) > Number(paymentOptions.find(p => p.publicId === selectedPaymentId)?.refundableRemaining ?? 0)}>
          {saving ? 'Submitting…' : 'Submit refund for approval'}
        </button>
      </form>
    </section>}

    <section className="finance-panel">
      <div className="finance-section-heading finance-section-heading-wrap"><div><h2>Adjustment ledger</h2>
        <p>Independent reviewer required. Requesters cannot approve/reject their own request; payout requires a different staff member.</p></div>
        <label className="finance-filter">Status<select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="ALL">All</option><option value="PENDING_APPROVAL">Pending approval</option>
          <option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="PAID">Paid</option>
        </select></label>
      </div>
      {loading ? <div className="finance-empty">Loading saved adjustment records…</div> : visibleAdjustments.length === 0
        ? <div className="finance-empty">No adjustments match this view. No example records are shown.</div>
        : <div className="finance-table-scroll"><table className="finance-table">
          <thead><tr><th>Reference</th><th>Invoice / customer</th><th>Amount</th><th>Status &amp; history</th><th>Actions</th></tr></thead>
          <tbody>{visibleAdjustments.map(item => <tr key={item.publicId}>
            <td><strong>{item.adjustmentNumber}</strong><small>{item.adjustmentType === 'CREDIT_NOTE' ? 'Credit adjustment' : 'Refund request'}</small>
              <small>Created by {item.createdByName} · {dateLabel(item.createdAt)}</small></td>
            <td>{item.invoiceNumber}<small>{item.sourceType} · {item.customerName}</small>
              {item.paymentReceiptNumber && <small>Receipt: {item.paymentReceiptNumber}</small>}</td>
            <td className="finance-amount">{money(item.amount)}</td>
            <td><span className={'finance-status finance-status-' + item.status.toLowerCase().replaceAll('_', '-')}>{statusLabel(item.status)}</span>
              {item.reviewedByName && <small>Reviewed by {item.reviewedByName} · {dateLabel(item.reviewedAt)}</small>}
              {item.reviewReason && <small>Reason: {item.reviewReason}</small>}
              {item.paidByName && <small>Paid-attested by {item.paidByName} · {dateLabel(item.paidAt)}</small>}
              {item.paymentMethod && <small>{item.paymentMethod.replaceAll('_', ' ')}{item.paymentReference ? ' · ' + item.paymentReference : ''}</small>}
              <button type="button" className="finance-small-button finance-small-button-muted" onClick={() => void showHistory(item)}>View history</button>
            </td>
            <td><div className="finance-row-actions">
              {canReview && item.status === 'PENDING_APPROVAL' && <>
                <button type="button" className="finance-small-button" disabled={saving} onClick={() => void approve(item.publicId)}>Approve</button>
                <button type="button" className="finance-small-button finance-small-button-muted" disabled={saving}
                  onClick={() => { setRejectingId(item.publicId); setRejectReason(''); }}>Reject</button>
              </>}
              {canPayout && item.adjustmentType === 'REFUND' && item.status === 'APPROVED' &&
                <button type="button" className="finance-small-button" disabled={saving || (referenceRequired && !payoutReference.trim())}
                  onClick={() => void markPaid(item.publicId)}>Record payout</button>}
              {rejectingId === item.publicId && <form className="finance-review-form" onSubmit={event => void reject(event)}>
                <label>Rejection reason<textarea required minLength={3} maxLength={500} rows={2} value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)} /></label>
                <button className="finance-small-button" type="submit" disabled={saving || rejectReason.trim().length < 3}>Confirm rejection</button>
                <button className="finance-small-button finance-small-button-muted" type="button"
                  onClick={() => setRejectingId('')}>Cancel</button>
              </form>}
              {item.status === 'PENDING_APPROVAL' && !canReview && <small>Awaiting authorised reviewer</small>}
            </div></td>
          </tr>)}</tbody></table></div>}
    </section>

    {canPayout && <section className="finance-panel">
      <div className="finance-section-heading"><div><h2>Refund payout attestation</h2>
        <p>Select the method/reference used outside this app, then choose “Record payout” on an approved refund above.</p></div></div>
      <div className="finance-expense-form">
        <label>Payout method<select value={payoutMethod} onChange={e => setPayoutMethod(e.target.value)}>
          <option value="CASH">Cash</option><option value="UPI">UPI</option><option value="BANK_TRANSFER">Bank transfer</option>
          <option value="CARD">Card</option><option value="OTHER">Other</option>
        </select></label>
        <label>External payout reference<input value={payoutReference} maxLength={160}
          onChange={e => setPayoutReference(e.target.value)} placeholder={referenceRequired ? 'Required for this method' : 'Optional evidence reference'} /></label>
      </div>
    </section>}

    {historyFor && <section className="finance-panel">
      <div className="finance-section-heading"><div><h2>Event history</h2><p>Append-only system history for the selected adjustment.</p></div>
        <button type="button" className="finance-small-button finance-small-button-muted" onClick={() => { setHistoryFor(''); setEvents([]); }}>Close history</button>
      </div>
      <div className="finance-table-scroll"><table className="finance-table">
        <thead><tr><th>When</th><th>Event</th><th>Actor</th><th>Reason / reference</th></tr></thead>
        <tbody>{events.map((event,index)=><tr key={historyFor + '-' + index}>
          <td>{dateLabel(event.createdAt)}</td><td>{statusLabel(event.eventType)}<small>{event.fromStatus || 'New'} → {event.toStatus}</small></td>
          <td>{event.actorName}</td><td>{event.reason}{event.externalReference && <small>Reference: {event.externalReference}</small>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
  </div>;
}
