import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../apiClient';
import DailyCloseWorkspace from './DailyCloseWorkspace';

type FinanceSummary = {
  salesInvoiceCount: number; salesInvoicedAmount: number | string; salesCollectedAmount: number | string;
  salesOutstandingAmount: number | string; workshopInvoiceCount: number;
  workshopInvoicedAmount: number | string; workshopCollectedAmount: number | string;
  workshopOutstandingAmount: number | string; totalOutstandingAmount: number | string;
  approvedExpenseAmount: number | string; pendingExpenseCount: number;
};
type Expense = {
  publicId: string; expenseNumber: string; expenseDate: string; category: string; description: string;
  vendorName: string | null; paymentMethod: string; paymentReference: string | null; amount: number | string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'REVERSED'; createdByName: string;
  reviewedByName: string | null; createdAt: string; reviewedAt: string | null; reviewReason: string | null;
  reversedByName: string | null; reversedAt: string | null; reversalReason: string | null;
  reversalReference: string | null;
};
type Props = { token: string; permissions: string[] };
type ReviewAction = { publicId: string; kind: 'REJECT' | 'REVERSE'; label: string };

function todayLocal(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function newRequestKey(): string { return crypto.randomUUID(); }
function money(value: number | string | undefined): string {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
    .format(Number.isFinite(parsed) ? parsed : 0);
}
function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(parsed);
}
function statusLabel(status: Expense['status']): string {
  return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function BillingWorkspace({ token, permissions }: Props) {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [form, setForm] = useState(() => ({
    idempotencyKey: newRequestKey(), expenseDate: todayLocal(), category: '', description: '',
    vendorName: '', paymentMethod: 'CASH', paymentReference: '', amount: '',
  }));

  const canCreate = permissions.includes('finance.expense');
  const canApprove = permissions.includes('finance.approve');
  const canReverse = permissions.includes('finance.expense.reverse');
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = filter === 'ALL' ? '' : '?status=' + encodeURIComponent(filter);
      const [nextSummary, nextExpenses] = await Promise.all([
        apiFetch<FinanceSummary>('/api/v1/admin/finance/summary', token),
        apiFetch<Expense[]>('/api/v1/admin/finance/expenses' + query, token),
      ]);
      setSummary(nextSummary);
      setExpenses(nextExpenses);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Finance records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filter, token]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      await apiFetch<Expense>('/api/v1/admin/finance/expenses', token, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: form.idempotencyKey, expenseDate: form.expenseDate, category: form.category.trim(),
          description: form.description.trim(), vendorName: form.vendorName.trim() || null,
          paymentMethod: form.paymentMethod, paymentReference: form.paymentReference.trim() || null,
          amount: Number(form.amount),
        }),
      });
      setForm({ idempotencyKey: newRequestKey(), expenseDate: todayLocal(), category: '', description: '',
        vendorName: '', paymentMethod: 'CASH', paymentReference: '', amount: '' });
      setNotice('Expense submitted for approval. The saved record is now in the expense ledger.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Expense could not be submitted.');
    } finally { setSaving(false); }
  }

  async function approveExpense(expense: Expense) {
    setSaving(true); setError(''); setNotice('');
    try {
      await apiFetch<Expense>('/api/v1/admin/finance/expenses/' + expense.publicId + '/approve',
        token, { method: 'POST' });
      setNotice('Expense ' + expense.expenseNumber + ' approved.');
      setReviewAction(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Expense could not be approved.');
    } finally { setSaving(false); }
  }

  function beginReview(expense: Expense, kind: ReviewAction['kind']) {
    setReviewAction({ publicId: expense.publicId, kind, label: kind === 'REJECT' ? 'Reject expense' : 'Reverse approved expense' });
    setReviewReason(''); setError(''); setNotice('');
  }

  async function submitReviewReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewAction) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const route = reviewAction.kind === 'REJECT' ? 'reject' : 'reverse';
      const body = reviewAction.kind === 'REJECT'
        ? { reason: reviewReason.trim() }
        : { reason: reviewReason.trim(), externalReference: null };
      await apiFetch<Expense>('/api/v1/admin/finance/expenses/' + reviewAction.publicId + '/' + route,
        token, { method: 'POST', body: JSON.stringify(body) });
      setNotice(reviewAction.kind === 'REJECT'
        ? 'Expense rejected. The reason is retained in its history.'
        : 'Expense reversed. The original record and reversal reason remain in the ledger.');
      setReviewAction(null); setReviewReason('');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The expense action could not be completed.');
    } finally { setSaving(false); }
  }

  const invoiceCount = (summary?.salesInvoiceCount ?? 0) + (summary?.workshopInvoiceCount ?? 0);
  const recordedCollections = Number(summary?.salesCollectedAmount ?? 0) + Number(summary?.workshopCollectedAmount ?? 0);

  return (
    <div className="finance-workspace">
      <section className="finance-header">
        <div>
          <div className="finance-eyebrow">BUSINESS CONTROL · LIVE RECORDS</div>
          <h1>Billing &amp; expenses</h1>
          <p>Review operational invoice totals, recorded collections, outstanding balances and business expenses.</p>
        </div>
        <div className="finance-invoice-count"><span>Issued operational invoices</span>
          <strong>{summary ? invoiceCount.toLocaleString('en-IN') : '—'}</strong></div>
      </section>

      {error && <div className="finance-alert finance-alert-error" role="alert">{error}</div>}
      {notice && <div className="finance-alert finance-alert-success" role="status">{notice}</div>}

      <DailyCloseWorkspace token={token} permissions={permissions} />

      <section className="finance-summary-grid" aria-label="Financial summary">
        <article className="finance-glass-card"><span className="finance-card-label">Sales invoiced</span>
          <strong>{summary ? money(summary.salesInvoicedAmount) : '—'}</strong>
          <small>{summary ? summary.salesInvoiceCount.toLocaleString('en-IN') + ' issued invoices' : 'Loading saved records…'}</small></article>
        <article className="finance-glass-card"><span className="finance-card-label">Workshop invoiced</span>
          <strong>{summary ? money(summary.workshopInvoicedAmount) : '—'}</strong>
          <small>{summary ? summary.workshopInvoiceCount.toLocaleString('en-IN') + ' issued invoices' : 'Loading saved records…'}</small></article>
        <article className="finance-glass-card"><span className="finance-card-label">Recorded collections</span>
          <strong>{summary ? money(recordedCollections) : '—'}</strong>
          <small>Manual payment entries that remain recorded</small></article>
        <article className="finance-glass-card finance-glass-card-warm"><span className="finance-card-label">Outstanding balance</span>
          <strong>{summary ? money(summary.totalOutstandingAmount) : '—'}</strong>
          <small>Across issued sales and workshop invoices</small></article>
        <article className="finance-glass-card"><span className="finance-card-label">Approved expenses</span>
          <strong>{summary ? money(summary.approvedExpenseAmount) : '—'}</strong>
          <small>Reversed expenses are excluded from this total</small></article>
        <article className="finance-glass-card finance-glass-card-pending"><span className="finance-card-label">Expenses awaiting review</span>
          <strong>{summary ? summary.pendingExpenseCount.toLocaleString('en-IN') : '—'}</strong>
          <small>Requires an authorised approver</small></article>
      </section>

      {canCreate && <section className="finance-panel finance-expense-form-panel">
        <div className="finance-section-heading"><div><h2>Record a business expense</h2>
          <p>New entries enter the approval queue and do not affect approved totals until accepted.</p></div></div>
        <form className="finance-expense-form" onSubmit={(event) => void submitExpense(event)}>
          <label>Expense date<input type="date" required value={form.expenseDate}
            onChange={(event) => setForm((current) => ({ ...current, expenseDate: event.target.value }))} /></label>
          <label>Category<input required maxLength={64} value={form.category} placeholder="e.g. Utilities, travel, rent"
            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} /></label>
          <label>Description<input required maxLength={500} value={form.description} placeholder="What was the expense for?"
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label>Amount (₹)<input type="number" min="0.01" max="999999999999.99" step="0.01" required value={form.amount}
            placeholder="0.00" onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></label>
          <label>Paid to / vendor<input maxLength={160} value={form.vendorName} placeholder="Optional"
            onChange={(event) => setForm((current) => ({ ...current, vendorName: event.target.value }))} /></label>
          <label>Payment method<select value={form.paymentMethod}
            onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))}>
            <option value="CASH">Cash</option><option value="UPI">UPI</option><option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CARD">Card</option><option value="OTHER">Other</option></select></label>
          <label>Payment reference<input maxLength={160} value={form.paymentReference} placeholder="Optional transaction or voucher reference"
            onChange={(event) => setForm((current) => ({ ...current, paymentReference: event.target.value }))} /></label>
          <div className="finance-form-actions"><button type="submit" className="finance-primary-button" disabled={saving}>
            {saving ? 'Saving…' : 'Submit for approval'}</button></div>
        </form>
      </section>}

      <section className="finance-panel">
        <div className="finance-section-heading finance-section-heading-wrap">
          <div><h2>Expense ledger</h2><p>Review decisions and reversals retain their actor, timestamp and reason.</p></div>
          <label className="finance-filter">Status<select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="ALL">All expenses</option><option value="PENDING_APPROVAL">Pending approval</option>
            <option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="REVERSED">Reversed</option>
          </select></label>
        </div>
        {loading ? <div className="finance-empty">Loading saved finance records…</div> : expenses.length === 0 ? (
          <div className="finance-empty">No saved expenses match this view. No sample records are displayed.</div>
        ) : <div className="finance-table-scroll"><table className="finance-table">
          <thead><tr><th>Expense</th><th>Date</th><th>Details</th><th>Amount</th><th>Status</th><th>History / actions</th></tr></thead>
          <tbody>{expenses.map((expense) => <tr key={expense.publicId}>
            <td><strong>{expense.expenseNumber}</strong><small>{expense.paymentMethod.replaceAll('_', ' ')}</small></td>
            <td>{dateLabel(expense.expenseDate)}</td>
            <td><strong>{expense.category}</strong><small>{expense.description}</small>
              {expense.vendorName && <small>Paid to: {expense.vendorName}</small>}
              {expense.paymentReference && <small>Ref: {expense.paymentReference}</small>}</td>
            <td className="finance-amount">{money(expense.amount)}</td>
            <td><span className={'finance-status finance-status-' + expense.status.toLowerCase().replaceAll('_', '-')}>{statusLabel(expense.status)}</span>
              <small>Created by {expense.createdByName}</small>
              {expense.reviewedByName && <small>Reviewed by {expense.reviewedByName}</small>}
              {expense.reviewReason && <small>Reason: {expense.reviewReason}</small>}
              {expense.reversedByName && <small>Reversed by {expense.reversedByName}</small>}
              {expense.reversalReason && <small>Reversal: {expense.reversalReason}</small>}</td>
            <td><div className="finance-row-actions">
              {expense.status === 'PENDING_APPROVAL' && canApprove && <>
                <button type="button" className="finance-small-button" disabled={saving} onClick={() => void approveExpense(expense)}>Approve</button>
                <button type="button" className="finance-small-button finance-small-button-muted" disabled={saving}
                  onClick={() => beginReview(expense, 'REJECT')}>Reject</button></>}
              {expense.status === 'APPROVED' && canReverse && <button type="button" className="finance-small-button finance-small-button-muted"
                disabled={saving} onClick={() => beginReview(expense, 'REVERSE')}>Reverse</button>}
              {reviewAction?.publicId === expense.publicId && <form className="finance-review-form"
                onSubmit={(event) => void submitReviewReason(event)}>
                <label>{reviewAction.label}<textarea required minLength={3} maxLength={500} rows={2} value={reviewReason}
                  onChange={(event) => setReviewReason(event.target.value)} placeholder="Enter a reason for the decision" /></label>
                <div><button className="finance-small-button" type="submit" disabled={saving || reviewReason.trim().length < 3}>Confirm</button>
                  <button className="finance-small-button finance-small-button-muted" type="button" disabled={saving}
                    onClick={() => { setReviewAction(null); setReviewReason(''); }}>Cancel</button></div>
              </form>}
              {expense.status === 'PENDING_APPROVAL' && !canApprove && <small>Awaiting authorised review</small>}
              {expense.status === 'APPROVED' && !canReverse && <small>Approved record</small>}
            </div></td>
          </tr>)}</tbody></table></div>}
      </section>

      <section className="finance-source-note">
        <strong>Source and accounting note</strong>
        <p>Totals are calculated from this dealership’s saved sales and workshop invoices, active recorded payment entries, and approved expenses. Existing invoices are operational records, not GST tax invoices. Payment entries reflect manual recording; this screen does not verify external bank, UPI or card settlement.</p>
        <div className="finance-source-split">
          <span>Sales collected: <b>{summary ? money(summary.salesCollectedAmount) : '—'}</b></span>
          <span>Workshop collected: <b>{summary ? money(summary.workshopCollectedAmount) : '—'}</b></span>
          <span>Sales outstanding: <b>{summary ? money(summary.salesOutstandingAmount) : '—'}</b></span>
          <span>Workshop outstanding: <b>{summary ? money(summary.workshopOutstandingAmount) : '—'}</b></span>
        </div>
      </section>
    </div>
  );
}
