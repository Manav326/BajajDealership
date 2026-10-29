import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../apiClient';
import type { StaffSummary } from '../auth/StaffLogin';

type RetailPartSetting = {
  publicId: string; skuCode: string; partName: string; description: string | null; unitOfMeasure: string;
  active: boolean; retailEnabled: boolean; retailPrice: number | null; retailDescription: string | null;
  fitmentModelCodes: string[]; imageUrl: string | null; quantityOnHand: number; quantityReserved: number;
  quantityAvailable: number; averageUnitCost: number;
};
type RetailOrderLine = {
  partPublicId: string; skuCode: string; partName: string; unitOfMeasure: string;
  quantity: number; unitPrice: number; lineTotal: number;
};
type RetailOrder = {
  publicId: string; orderCode: string; status: string; paymentMethod: string; paymentStatus: string;
  orderTotal: number; fulfillmentMethod: 'PICKUP' | 'DELIVERY'; deliveryAddress: string | null;
  deliveryFee: number; deliveryQuoteStatus: string; deliveryQuoteNote: string | null; deliveryQuotedAt: string | null;
  customerNote: string | null; createdAt: string; updatedAt: string;
  cancelledAt: string | null; fulfilledAt: string | null; returnedAt: string | null;
  returnReason: string | null; restockedOnReturn: boolean | null; customerName: string;
  customerCode: string; customerPhone: string | null; lines: RetailOrderLine[];
};
type SettingsDraft = {
  retailEnabled: boolean; retailPrice: string; retailDescription: string;
  fitmentModelCodes: string; imageUrl: string;
};
type CollectionDraft = {
  collectionMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CARD' | 'OTHER';
  externalReference: string; note: string; idempotencyKey: string;
};
type ReturnDraft = { reason: string; restockable: boolean; idempotencyKey: string };
type DeliveryQuoteDraft = { deliveryFee: string; note: string; idempotencyKey: string };
const newKey = () => globalThis.crypto?.randomUUID?.() ?? `retail-pickup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const money = (value: number | null | undefined) => `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};
const pretty = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
function toDraft(part: RetailPartSetting): SettingsDraft {
  return {
    retailEnabled: part.retailEnabled,
    retailPrice: part.retailPrice == null ? '' : String(part.retailPrice),
    retailDescription: part.retailDescription ?? '',
    fitmentModelCodes: part.fitmentModelCodes.join(', '),
    imageUrl: part.imageUrl ?? '',
  };
}

export default function RetailPartsCommercePanel({ token, staff }: { token: string; staff: StaffSummary }) {
  const canManage = staff.permissions.includes('parts.manage');
  const [parts, setParts] = useState<RetailPartSetting[]>([]);
  const [orders, setOrders] = useState<RetailOrder[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SettingsDraft>>({});
  const [openEditor, setOpenEditor] = useState('');
  const [collections, setCollections] = useState<Record<string, CollectionDraft>>({});
  const [returns, setReturns] = useState<Record<string, ReturnDraft>>({});
  const [deliveryQuotes, setDeliveryQuotes] = useState<Record<string, DeliveryQuoteDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [loadedParts, loadedOrders] = await Promise.all([
        apiFetch<RetailPartSetting[]>('/api/v1/admin/retail-parts', token),
        apiFetch<RetailOrder[]>('/api/v1/admin/retail-part-orders?limit=100', token),
      ]);
      setParts(loadedParts ?? []);
      setOrders(loadedOrders ?? []);
      setDrafts((current) => {
        const next = { ...current };
        for (const part of loadedParts ?? []) next[part.publicId] = next[part.publicId] ?? toDraft(part);
        return next;
      });
      setCollections((current) => {
        const next = { ...current };
        for (const order of loadedOrders ?? []) {
          next[order.publicId] = next[order.publicId] ?? {
            collectionMethod: 'UPI', externalReference: '', note: '', idempotencyKey: newKey(),
          };
        }
        return next;
      });
      setReturns((current) => {
        const next = { ...current };
        for (const order of loadedOrders ?? []) {
          next[order.publicId] = next[order.publicId] ?? { reason: '', restockable: false, idempotencyKey: newKey() };
        }
        return next;
      });
      setDeliveryQuotes((current) => {
        const next = { ...current };
        for (const order of loadedOrders ?? []) {
          next[order.publicId] = next[order.publicId] ?? { deliveryFee: '', note: '', idempotencyKey: newKey() };
        }
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Retail parts workspace could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function saveSettings(part: RetailPartSetting) {
    const draft = drafts[part.publicId] ?? toDraft(part);
    const price = draft.retailPrice.trim();
    if (draft.retailEnabled && (!price || !Number.isFinite(Number(price)) || Number(price) <= 0)) {
      setError('Enter a positive retail price before publishing a part.');
      return;
    }
    const fitments = draft.fitmentModelCodes.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
    setBusyId(part.publicId); setError(''); setMessage('');
    try {
      const updated = await apiFetch<RetailPartSetting>(
        `/api/v1/admin/retail-parts/${part.publicId}`, token, {
          method: 'PUT',
          body: JSON.stringify({
            retailEnabled: draft.retailEnabled,
            retailPrice: price ? Number(price) : null,
            retailDescription: draft.retailDescription.trim() || null,
            fitmentModelCodes: fitments,
            imageUrl: draft.imageUrl.trim() || null,
          }),
        });
      setParts((current) => current.map((item) => item.publicId === updated.publicId ? updated : item));
      setDrafts((current) => ({ ...current, [updated.publicId]: toDraft(updated) }));
      setOpenEditor('');
      setMessage(`${updated.skuCode} ${updated.retailEnabled ? 'is now published in' : 'was removed from'} the customer retail shop.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Retail listing settings could not be saved.');
    } finally {
      setBusyId('');
    }
  }

  async function fulfill(order: RetailOrder) {
    const draft = collections[order.publicId] ?? {
      collectionMethod: 'UPI', externalReference: '', note: '', idempotencyKey: newKey(),
    };
    setBusyId(order.publicId); setError(''); setMessage('');
    try {
      const updated = await apiFetch<RetailOrder>(
        `/api/v1/admin/retail-part-orders/${order.publicId}/fulfill`, token, {
          method: 'POST',
          body: JSON.stringify({
            collectionMethod: draft.collectionMethod,
            externalReference: draft.externalReference.trim() || null,
            idempotencyKey: draft.idempotencyKey,
            note: draft.note.trim() || null,
          }),
        });
      setOrders((current) => current.map((item) => item.publicId === updated.publicId ? updated : item));
      setCollections((current) => ({ ...current, [order.publicId]: { ...draft, idempotencyKey: newKey() } }));
      setMessage(`Order ${updated.orderCode} fulfilled; stock was deducted and the collection receipt recorded.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The order could not be fulfilled.');
    } finally {
      setBusyId('');
    }
  }


  async function quoteDelivery(order: RetailOrder) {
    const draft = deliveryQuotes[order.publicId] ?? { deliveryFee: '', note: '', idempotencyKey: newKey() };
    const parsedFee = Number(draft.deliveryFee);
    if (!draft.deliveryFee.trim() || !Number.isFinite(parsedFee) || parsedFee < 0) {
      setError('Enter the actual non-negative delivery fee before quoting the customer.');
      return;
    }
    setBusyId(order.publicId); setError(''); setMessage('');
    try {
      const updated = await apiFetch<RetailOrder>(
        '/api/v1/admin/retail-part-orders/' + order.publicId + '/delivery-quote', token, {
          method: 'POST',
          body: JSON.stringify({ deliveryFee: parsedFee, note: draft.note.trim() || null, idempotencyKey: draft.idempotencyKey }),
        });
      setOrders((current) => current.map((item) => item.publicId === updated.publicId ? updated : item));
      setDeliveryQuotes((current) => ({ ...current, [order.publicId]: { deliveryFee: '', note: '', idempotencyKey: newKey() } }));
      setMessage('Delivery quote saved for ' + updated.orderCode + '. The customer must accept it before staff can record delivery and payment.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The delivery quote could not be saved.');
    } finally {
      setBusyId('');
    }
  }

  function updateDeliveryQuote(order: RetailOrder, patch: Partial<DeliveryQuoteDraft>) {
    setDeliveryQuotes((current) => ({
      ...current,
      [order.publicId]: { ...(current[order.publicId] ?? { deliveryFee: '', note: '', idempotencyKey: newKey() }), ...patch },
    }));
  }
  async function recordReturn(order: RetailOrder) {
    const draft = returns[order.publicId] ?? { reason: '', restockable: false, idempotencyKey: newKey() };
    if (!draft.reason.trim()) {
      setError('Enter the reason for this full-order return.');
      return;
    }
    setBusyId(order.publicId); setError(''); setMessage('');
    try {
      const updated = await apiFetch<RetailOrder>(
        '/api/v1/admin/retail-part-orders/' + order.publicId + '/return', token, {
          method: 'POST',
          body: JSON.stringify({
            reason: draft.reason.trim(),
            restockable: draft.restockable,
            idempotencyKey: draft.idempotencyKey,
          }),
        });
      setOrders((current) => current.map((item) => item.publicId === updated.publicId ? updated : item));
      setReturns((current) => ({ ...current, [order.publicId]: { ...draft, idempotencyKey: newKey() } }));
      setMessage('Return recorded for ' + updated.orderCode + '. The collected amount is flagged for refund review; no automatic refund was issued.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The return could not be recorded.');
    } finally {
      setBusyId('');
    }
  }

  function updateDraft(part: RetailPartSetting, patch: Partial<SettingsDraft>) {
    setDrafts((current) => ({ ...current, [part.publicId]: { ...(current[part.publicId] ?? toDraft(part)), ...patch } }));
  }
  function updateCollection(order: RetailOrder, patch: Partial<CollectionDraft>) {
    setCollections((current) => ({
      ...current,
      [order.publicId]: { ...(current[order.publicId] ?? {
        collectionMethod: 'UPI', externalReference: '', note: '', idempotencyKey: newKey(),
      }), ...patch },
    }));
  }

  return <div className="retail-admin-workspace">
    <div className="spare-parts-panel retail-admin-intro">
      <div className="spare-parts-section-heading">
        <div><h2>Customer retail shop</h2><p>Choose which SKUs customers can buy, maintain retail price and Bajaj fitment, quote delivery explicitly, and record pickup/delivery collection. Workshop reservations remain protected.</p></div>
        <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>↻ Refresh</button>
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {message && <div className="notice notice-success" role="status">{message}</div>}
      <div className="retail-admin-summaries">
        <article><small>Retail listings</small><strong>{parts.filter((part) => part.retailEnabled).length}</strong><span>Enabled SKU(s)</span></article>
        <article><small>Available for retail</small><strong>{parts.filter((part) => part.retailEnabled && part.quantityAvailable > 0).length}</strong><span>After reservations</span></article>
        <article><small>Open retail orders</small><strong>{orders.filter((order) => order.status === 'PLACED').length}</strong><span>Awaiting quote, acceptance or fulfilment</span></article>
      </div>
    </div>

    <section className="spare-parts-panel">
      <div className="spare-parts-section-heading"><div><h2>Retail catalogue settings</h2><p>Only retail-enabled parts with an explicit price appear to customers. The listed price is separate from average purchase cost.</p></div><span className="spare-parts-count">{parts.length} SKU(s)</span></div>
      {loading ? <div className="studio-empty">Loading retail SKU settings…</div>
        : parts.length === 0 ? <div className="studio-empty">Create a spare-part SKU and receive stock before enabling it for retail.</div>
        : <div className="retail-admin-list">{parts.map((part) => {
          const draft = drafts[part.publicId] ?? toDraft(part);
          const open = openEditor === part.publicId;
          return <article className="retail-admin-part" key={part.publicId}>
            <div className="retail-admin-part-summary">
              {part.imageUrl ? <img src={part.imageUrl} alt="" loading="lazy" /> : <div className="retail-admin-part-mark">LB</div>}
              <div className="retail-admin-part-copy"><strong>{part.partName}</strong><small>{part.skuCode} · {part.unitOfMeasure}</small><span>On hand {part.quantityOnHand} · Reserved {part.quantityReserved} · Available {part.quantityAvailable}</span></div>
              <div className="retail-admin-part-right"><strong>{part.retailPrice == null ? 'Price not set' : money(part.retailPrice)}</strong><span className={part.retailEnabled ? 'retail-admin-badge enabled' : 'retail-admin-badge'}>{part.retailEnabled ? 'Published' : 'Hidden'}</span><button className="secondary-button" type="button" onClick={() => setOpenEditor(open ? '' : part.publicId)}>{open ? 'Close editor' : 'Edit listing'}</button></div>
            </div>
            {open && <form className="retail-admin-editor" onSubmit={(event) => { event.preventDefault(); void saveSettings(part); }}>
              <label className="retail-admin-enable"><input type="checkbox" checked={draft.retailEnabled} onChange={(event) => updateDraft(part, { retailEnabled: event.target.checked })} /> Show this part in the customer shop</label>
              <div className="spare-parts-form-grid">
                <label>Retail price (₹) *<input type="number" min="0.01" step="0.01" value={draft.retailPrice} onChange={(event) => updateDraft(part, { retailPrice: event.target.value })} required={draft.retailEnabled} placeholder="Customer selling price" /></label>
                <label>Image URL (HTTPS)<input type="url" maxLength={1000} value={draft.imageUrl} onChange={(event) => updateDraft(part, { imageUrl: event.target.value })} placeholder="https://…" /></label>
                <label className="spare-full-label">Customer-facing description<textarea rows={2} maxLength={1000} value={draft.retailDescription} onChange={(event) => updateDraft(part, { retailDescription: event.target.value })} placeholder={part.description ?? 'Describe the part clearly'} /></label>
                <label className="spare-full-label">Compatible Bajaj model codes (comma-separated, optional)<input maxLength={2400} value={draft.fitmentModelCodes} onChange={(event) => updateDraft(part, { fitmentModelCodes: event.target.value })} placeholder="BAJAJ_PULSAR_NS160, BAJAJ_PULSAR_N160" /><small>Leave empty only for a genuinely universal fit. Model codes are validated against the published Bajaj catalogue.</small></label>
              </div>
              <div className="retail-admin-editor-actions"><span>Supplier cost stays staff-only and is never returned by the customer catalogue.</span><button type="button" className="secondary-button" onClick={() => { setDrafts((current) => ({ ...current, [part.publicId]: toDraft(part) })); setOpenEditor(''); }}>Discard</button><button type="submit" className="primary-button" disabled={!canManage || busyId === part.publicId}>{busyId === part.publicId ? 'Saving…' : 'Save retail listing'}</button></div>
            </form>}
          </article>;
        })}</div>}
    </section>

    <section className="spare-parts-panel">
      <div className="spare-parts-section-heading"><div><h2>Pickup orders</h2><p>Fulfil a placed order only after the customer has paid at pickup. This action records a staff-attested operational collection, not gateway verification.</p></div><span className="spare-parts-count">{orders.filter((order) => order.status === 'PLACED').length} pending</span></div>
      {orders.length === 0 ? <div className="studio-empty">No retail pickup orders yet.</div>
        : <div className="retail-admin-order-list">{orders.map((order) => {
          const draft = collections[order.publicId] ?? {
            collectionMethod: 'UPI', externalReference: '', note: '', idempotencyKey: newKey(),
          };
          return <article className="retail-admin-order" key={order.publicId}>
            <div className="retail-admin-order-head"><div><strong>{order.orderCode}</strong><small>{order.customerName} · {order.customerPhone || order.customerCode} · {dateLabel(order.createdAt)}</small><small>{order.fulfillmentMethod === 'DELIVERY' ? 'DELIVERY REQUEST' : 'PICKUP ORDER'}{order.fulfillmentMethod === 'DELIVERY' && order.deliveryAddress ? ' · ' + order.deliveryAddress : ''}</small></div><div className="retail-admin-order-total"><strong>{money(order.orderTotal)}</strong><span className={`sales-status status-${order.status.toLowerCase().replaceAll('_', '-')}`}>{pretty(order.status)}</span></div></div>
            <div className="retail-admin-order-lines">{order.lines.map((line) => <div key={line.partPublicId}><span>{line.skuCode} · {line.partName} <small>({line.quantity} {line.unitOfMeasure})</small></span><strong>{money(line.lineTotal)}</strong></div>)}</div>
            {order.customerNote && <p className="retail-admin-order-note">Customer note: {order.customerNote}</p>}
            {order.status === 'PLACED' && order.fulfillmentMethod === 'DELIVERY' && order.deliveryQuoteStatus === 'AWAITING_STAFF_QUOTE' ? (
              <form className="retail-admin-collection-form" onSubmit={(event) => { event.preventDefault(); void quoteDelivery(order); }}>
                <strong>Delivery quote required</strong>
                <small>Customer total currently reflects parts only. Enter the actual delivery charge; no default rate is assumed.</small>
                <label>Delivery fee (₹) *<input required type="number" min="0" step="0.01" value={(deliveryQuotes[order.publicId] ?? { deliveryFee: '', note: '', idempotencyKey: newKey() }).deliveryFee} onChange={(event) => updateDeliveryQuote(order, { deliveryFee: event.target.value })} placeholder="Fee confirmed by the dealership" /></label>
                <label>Quote note (optional)<input maxLength={1000} value={(deliveryQuotes[order.publicId] ?? { deliveryFee: '', note: '', idempotencyKey: newKey() }).note} onChange={(event) => updateDeliveryQuote(order, { note: event.target.value })} placeholder="Delivery timing or scope" /></label>
                <button type="submit" className="primary-button" disabled={!canManage || busyId === order.publicId}>{busyId === order.publicId ? 'Saving quote…' : 'Send delivery quote to customer'}</button>
              </form>
            ) : order.status === 'PLACED' && order.fulfillmentMethod === 'DELIVERY' && order.deliveryQuoteStatus === 'AWAITING_CUSTOMER_CONFIRMATION' ? (
              <div className="retail-admin-fulfilled-note">
                Delivery fee quoted: {money(order.deliveryFee)} · {dateLabel(order.deliveryQuotedAt)}. Waiting for the customer to accept or decline.
                {order.deliveryQuoteNote && <p>Quote note: {order.deliveryQuoteNote}</p>}
                <small>No delivery collection or stock deduction can be recorded until acceptance.</small>
              </div>
            ) : order.status === 'PLACED' ? (
              <form className="retail-admin-collection-form" onSubmit={(event) => { event.preventDefault(); void fulfill(order); }}>
                {order.fulfillmentMethod === 'DELIVERY' && <><strong>Customer accepted delivery quote</strong><p>Agreed delivery fee: {money(order.deliveryFee)}. Record payment when the parts are delivered; this is a manual staff attestation, not gateway verification.</p></>}
                <label>Collection method<select value={draft.collectionMethod} onChange={(event) => updateCollection(order, { collectionMethod: event.target.value as CollectionDraft['collectionMethod'] })}><option value="UPI">UPI</option><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></label>
                <label>Receipt / reference<input maxLength={160} value={draft.externalReference} onChange={(event) => updateCollection(order, { externalReference: event.target.value })} placeholder="Optional transaction reference" /></label>
                <label>Collection note<input maxLength={1000} value={draft.note} onChange={(event) => updateCollection(order, { note: event.target.value })} placeholder="Optional pickup/delivery note" /></label>
                <button type="submit" className="primary-button" disabled={!canManage || busyId === order.publicId}>{busyId === order.publicId ? 'Recording…' : order.fulfillmentMethod === 'DELIVERY' ? 'Record delivery & payment' : 'Record pickup & payment'}</button>
              </form>
            ) : order.status === 'FULFILLED' ? (
              <>
                <div className="retail-admin-fulfilled-note">{(order.fulfillmentMethod === 'DELIVERY' ? 'Delivered ' : 'Collected ') + dateLabel(order.fulfilledAt) + ' · ' + pretty(order.paymentStatus)}</div>
                <form className="retail-admin-collection-form" onSubmit={(event) => { event.preventDefault(); void recordReturn(order); }}>
                  <label>Return reason *<input required maxLength={1000} value={(returns[order.publicId] ?? { reason: '', restockable: false, idempotencyKey: newKey() }).reason} onChange={(event) => setReturns((current) => ({ ...current, [order.publicId]: { ...(current[order.publicId] ?? { reason: '', restockable: false, idempotencyKey: newKey() }), reason: event.target.value } }))} placeholder="Record why the full order is returned" /></label>
                  <label className="retail-admin-enable"><input type="checkbox" checked={(returns[order.publicId] ?? { reason: '', restockable: false, idempotencyKey: newKey() }).restockable} onChange={(event) => setReturns((current) => ({ ...current, [order.publicId]: { ...(current[order.publicId] ?? { reason: '', restockable: false, idempotencyKey: newKey() }), restockable: event.target.checked } }))} /> I inspected every returned item and confirm it is fit for resale</label>
                  <small>Full-order return only. If any item is not resaleable, leave unchecked so no returned quantity becomes available. This does not issue a refund.</small>
                  <button type="submit" className="secondary-button" disabled={!canManage || busyId === order.publicId}>{busyId === order.publicId ? 'Recording…' : 'Record full return'}</button>
                </form>
              </>
            ) : order.status === 'RETURNED' ? (
              <div className="retail-admin-fulfilled-note">
                {'Returned ' + dateLabel(order.returnedAt) + ' · ' + (order.restockedOnReturn ? 'restocked after inspection' : 'held out of sellable stock') + ' · refund review required. ' + (order.returnReason ?? '')}
              </div>
            ) : (
              <div className="retail-admin-fulfilled-note">{'Cancelled ' + dateLabel(order.cancelledAt)}</div>
            )}
          </article>;
        })}</div>}
    </section>
  </div>;
}
