import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../apiClient';
import type { StaffSummary } from '../auth/StaffLogin';

type CustomerWebsiteRequest = {
  publicId: string; requestCode: string; requestType: 'TEST_RIDE' | 'PURCHASE';
  modelCode: string; modelName: string; preferredAt: string | null; notes: string | null;
  status: 'REQUESTED' | 'CONVERTED' | 'CANCELLED'; createdAt: string; updatedAt: string;
  convertedEnquiryPublicId: string | null; customerPublicId: string; customerCode: string;
  customerName: string; customerPhone: string | null; customerEmail: string | null;
};

function dateLabel(value: string | null | undefined) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Not set'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}
function titleCase(value: string | null | undefined) {
  return (value ?? '').replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export default function CustomerSalesRequestsPanel({
  token, staff, onOpenEnquiry,
}: {
  token: string;
  staff: StaffSummary;
  onOpenEnquiry: (publicId: string) => void | Promise<void>;
}) {
  const canManage = staff.permissions.includes('sales.manage');
  const [requests, setRequests] = useState<CustomerWebsiteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiFetch<CustomerWebsiteRequest[]>(
        '/api/v1/admin/sales/customer-requests?limit=100', token);
      setRequests(result ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Website requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function convert(request: CustomerWebsiteRequest) {
    setBusyId(request.publicId);
    setError('');
    setSuccess('');
    try {
      const updated = await apiFetch<CustomerWebsiteRequest>(
        '/api/v1/admin/sales/customer-requests/' + request.publicId + '/convert',
        token, { method: 'POST' });
      setRequests((current) => current.map((item) => item.publicId === updated.publicId ? updated : item));
      setSuccess(`${request.requestCode} was added to the sales pipeline. Confirm a physical bike and test-ride time separately.`);
      if (updated.convertedEnquiryPublicId) await onOpenEnquiry(updated.convertedEnquiryPublicId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request could not be converted to a sales enquiry.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="sales-list-panel sales-bookings-panel">
      <div className="sales-section-heading">
        <div><h2>Customer website requests</h2><p>Requests from the public Bajaj showroom. Conversion creates a sales enquiry; it does not reserve a physical bike or confirm a test-ride slot.</p></div>
        <span className="sales-counter">{requests.filter((request) => request.status === 'REQUESTED').length} pending</span>
      </div>
      <div className="sales-heading-actions">
        <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>↻ Refresh requests</button>
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {success && <div className="notice notice-success" role="status">{success}</div>}
      {loading ? <div className="studio-empty">Loading website requests…</div>
        : requests.length === 0 ? <div className="studio-empty">No website requests yet. Requests made from the public Bajaj showroom will appear here.</div>
        : <div className="sales-table-wrap"><table className="sales-table">
          <thead><tr><th>Request</th><th>Customer</th><th>Bajaj motorcycle</th><th>Requested</th><th>Status</th><th /></tr></thead>
          <tbody>{requests.map((request) => <tr key={request.publicId}>
            <td><strong>{request.requestCode}</strong><small>{request.requestType === 'TEST_RIDE' ? 'Test ride' : 'Purchase enquiry'}</small></td>
            <td><strong>{request.customerName}</strong><small>{request.customerPhone || request.customerEmail || request.customerCode}</small></td>
            <td><strong>{request.modelName}</strong><small>{request.modelCode}</small></td>
            <td><strong>{dateLabel(request.createdAt)}</strong><small>{request.preferredAt ? 'Preferred: ' + dateLabel(request.preferredAt) : 'Time to be confirmed'}</small></td>
            <td><span className={`sales-status status-${request.status.toLowerCase().replaceAll('_', '-')}`}>{titleCase(request.status)}</span></td>
            <td>{request.status === 'REQUESTED' && canManage
              ? <button type="button" className="primary-button" disabled={busyId === request.publicId} onClick={() => void convert(request)}>{busyId === request.publicId ? 'Converting…' : 'Convert to enquiry'}</button>
              : request.convertedEnquiryPublicId
                ? <button type="button" className="text-button" onClick={() => void onOpenEnquiry(request.convertedEnquiryPublicId!)}>Open enquiry</button>
                : <span className="sales-help-text">No action available</span>}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  );
}
