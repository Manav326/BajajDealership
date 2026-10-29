import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../apiClient';
import type { StaffSummary } from '../auth/StaffLogin';
import RetailPartsCommercePanel from './RetailPartsCommercePanel';

type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
type Part = {
  publicId: string; skuCode: string; partName: string; description: string | null; unitOfMeasure: string;
  active: boolean; quantityOnHand: number; quantityReserved: number; quantityAvailable: number;
  averageUnitCost: number; createdAt: string; updatedAt: string;
};
type Supplier = {
  publicId: string; supplierCode: string; supplierName: string; contactName: string | null;
  phone: string | null; email: string | null; address: string | null; notes: string | null;
  active: boolean; createdAt: string; updatedAt: string;
};
type ReceiptLine = {
  lineNumber: number; partPublicId: string; skuCode: string; partName: string; unitOfMeasure: string;
  quantity: number; unitCost: number; lineTotal: number;
};
type Receipt = {
  publicId: string; receiptNumber: string; supplierPublicId: string; supplierCode: string;
  supplierName: string; supplierReference: string | null; status: string; totalCost: number;
  notes: string | null; receivedByName: string; receivedAt: string; lines: ReceiptLine[];
};
type ReceiptSummary = {
  publicId: string; receiptNumber: string; supplierName: string; supplierReference: string | null;
  status: string; totalCost: number; receivedAt: string; receivedByName: string;
};
type Movement = {
  publicId: string; partPublicId: string; skuCode: string; partName: string; movementType: string;
  quantityDelta: number; reservedDelta: number; quantityOnHandAfter: number; quantityReservedAfter: number;
  unitCost: number; referenceType: string; referenceId: string; operationKey: string;
  actorName: string; createdAt: string;
};
type JobCardOption = {
  publicId: string; jobCardCode: string; status: string; customerName: string;
  modelName: string; variantName: string | null; chassisNumber: string;
};
type Reservation = {
  publicId: string; reservationCode: string; jobCardPublicId: string; jobCardCode: string;
  partPublicId: string; skuCode: string; partName: string; unitOfMeasure: string;
  quantityReserved: number; quantityIssued: number; quantityReturned: number; quantityReleased: number;
  quantityRemainingToIssue: number; unitCostSnapshot: number; status: string; notes: string | null;
  reservedByName: string; createdAt: string; updatedAt: string;
};
type ReceiptLineDraft = { partPublicId: string; quantity: string; unitCost: string };
type ReservationDraft = { quantity: string; notes: string };
type OperationKind = 'issue' | 'return' | 'release';

const units = ['EACH', 'PAIR', 'SET', 'LITRE', 'ML', 'GRAM', 'KG', 'METER'];
const newKey = () => globalThis.crypto?.randomUUID?.()
  ?? `qe-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function displayDate(raw: string | null) {
  if (!raw) return '—';
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function money(value: number | null | undefined) {
  return `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function prettyStatus(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function quantity(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export default function SparePartsWorkspace({ token, staff }: { token: string; staff: StaffSummary }) {
  const canManageParts = staff.permissions.includes('parts.manage');
  const canReceive = staff.permissions.includes('parts.receive');
  const canReserve = staff.permissions.includes('parts.reserve');
  const canIssue = staff.permissions.includes('parts.issue');
  const canReturn = staff.permissions.includes('parts.return');

  const [activeTab, setActiveTab] = useState<'stock' | 'receiving' | 'jobCards' | 'retail'>('stock');
  const [partsList, setPartsList] = useState<Part[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [receipts, setReceipts] = useState<ReceiptSummary[]>([]);
  const [jobCards, setJobCards] = useState<JobCardOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [partQueryInput, setPartQueryInput] = useState('');
  const [partQuery, setPartQuery] = useState('');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [showPartForm, setShowPartForm] = useState(false);
  const [partForm, setPartForm] = useState({
    skuCode: '', partName: '', description: '', unitOfMeasure: 'EACH',
  });

  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [supplierForm, setSupplierForm] = useState({
    supplierCode: '', supplierName: '', contactName: '', phone: '', email: '', address: '', notes: '',
  });
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [supplierReference, setSupplierReference] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [receiptKey, setReceiptKey] = useState(newKey);
  const [receiptLines, setReceiptLines] = useState<ReceiptLineDraft[]>([
    { partPublicId: '', quantity: '1', unitCost: '' },
  ]);
  const [latestReceipt, setLatestReceipt] = useState<Receipt | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState('');

  const [jobCardQueryInput, setJobCardQueryInput] = useState('');
  const [jobCardQuery, setJobCardQuery] = useState('');
  const [selectedJobCardId, setSelectedJobCardId] = useState('');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loadingReservations, setLoadingReservations] = useState(false);
  const [reservePartId, setReservePartId] = useState('');
  const [reserveQuantity, setReserveQuantity] = useState('1');
  const [reserveNotes, setReserveNotes] = useState('');
  const [reserveKey, setReserveKey] = useState(newKey);
  const [reservationDrafts, setReservationDrafts] = useState<Record<string, ReservationDraft>>({});
  const [operationKeys, setOperationKeys] = useState<Record<string, string>>({});
  const [operationBusy, setOperationBusy] = useState('');

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const partParams = new URLSearchParams({ page: '0', pageSize: '100', activeOnly: 'true' });
      if (partQuery) partParams.set('q', partQuery);
      const supplierParams = new URLSearchParams({ page: '0', pageSize: '100', activeOnly: 'true' });
      const cardParams = new URLSearchParams();
      if (jobCardQuery) cardParams.set('q', jobCardQuery);
      const [partPage, supplierPage, receiptPage, cards] = await Promise.all([
        apiFetch<Page<Part>>(`/api/v1/admin/parts?${partParams.toString()}`, token),
        apiFetch<Page<Supplier>>(`/api/v1/admin/part-suppliers?${supplierParams.toString()}`, token),
        apiFetch<Page<ReceiptSummary>>('/api/v1/admin/part-receipts?page=0&pageSize=25', token),
        apiFetch<JobCardOption[]>(`/api/v1/admin/part-job-cards${cardParams.size ? `?${cardParams.toString()}` : ''}`, token),
      ]);
      setPartsList(partPage.items ?? []);
      setSuppliers(supplierPage.items ?? []);
      setReceipts(receiptPage.items ?? []);
      setJobCards(cards ?? []);
      setSelectedSupplierId((current) => current && supplierPage.items.some((item) => item.publicId === current)
        ? current : supplierPage.items[0]?.publicId ?? '');
      setReservePartId((current) => current && partPage.items.some((item) => item.publicId === current)
        ? current : partPage.items[0]?.publicId ?? '');
      setSelectedJobCardId((current) => current && (cards ?? []).some((item) => item.publicId === current)
        ? current : (cards ?? [])[0]?.publicId ?? '');
      setSelectedPartId((current) => current && partPage.items.some((item) => item.publicId === current)
        ? current : partPage.items[0]?.publicId ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Spare-parts workspace could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [token, partQuery, jobCardQuery]);

  const loadMovements = useCallback(async (publicId: string) => {
    if (!publicId) {
      setMovements([]);
      return;
    }
    setLoadingMovements(true);
    try {
      const result = await apiFetch<Page<Movement>>(
        `/api/v1/admin/parts/${publicId}/movements?page=0&pageSize=50`, token);
      setMovements(result.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Stock movement history could not be loaded.');
    } finally {
      setLoadingMovements(false);
    }
  }, [token]);

  const loadReservations = useCallback(async (jobCardPublicId: string) => {
    if (!jobCardPublicId) {
      setReservations([]);
      return;
    }
    setLoadingReservations(true);
    try {
      const result = await apiFetch<Reservation[]>(
        `/api/v1/admin/job-cards/${jobCardPublicId}/part-reservations`, token);
      setReservations(result ?? []);
      setReservationDrafts((current) => {
        const next = { ...current };
        for (const item of result ?? []) {
          if (!next[item.publicId]) next[item.publicId] = { quantity: '1', notes: '' };
        }
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Job-card part reservations could not be loaded.');
    } finally {
      setLoadingReservations(false);
    }
  }, [token]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => { void loadMovements(selectedPartId); }, [loadMovements, selectedPartId]);
  useEffect(() => { void loadReservations(selectedJobCardId); }, [loadReservations, selectedJobCardId]);

  async function createPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      const created = await apiFetch<Part>('/api/v1/admin/parts', token, {
        method: 'POST',
        body: JSON.stringify({
          skuCode: partForm.skuCode.trim().toUpperCase(), partName: partForm.partName.trim(),
          description: partForm.description.trim() || null, unitOfMeasure: partForm.unitOfMeasure,
        }),
      });
      setPartForm({ skuCode: '', partName: '', description: '', unitOfMeasure: 'EACH' });
      setShowPartForm(false);
      setMessage(`Created SKU ${created.skuCode} with zero opening quantity. Receive stock to increase availability.`);
      await loadWorkspace();
      setSelectedPartId(created.publicId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Spare part could not be created.');
    } finally { setSaving(false); }
  }

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      const created = await apiFetch<Supplier>('/api/v1/admin/part-suppliers', token, {
        method: 'POST',
        body: JSON.stringify({
          supplierCode: supplierForm.supplierCode.trim().toUpperCase(),
          supplierName: supplierForm.supplierName.trim(),
          contactName: supplierForm.contactName.trim() || null,
          phone: supplierForm.phone.trim() || null,
          email: supplierForm.email.trim() || null,
          address: supplierForm.address.trim() || null,
          notes: supplierForm.notes.trim() || null,
        }),
      });
      setSupplierForm({ supplierCode: '', supplierName: '', contactName: '', phone: '', email: '', address: '', notes: '' });
      setShowSupplierForm(false);
      setSelectedSupplierId(created.publicId);
      setMessage(`Supplier ${created.supplierCode} saved.`);
      await loadWorkspace();
      setActiveTab('receiving');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Supplier could not be saved.');
    } finally { setSaving(false); }
  }

  async function receiveStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSupplierId) {
      setError('Choose an active supplier before receiving stock.');
      return;
    }
    setSaving(true); setError(''); setMessage('');
    try {
      const normalized = receiptLines.map((line) => {
        if (!line.partPublicId) throw new Error('Choose a part for every receipt line.');
        const qty = Number(line.quantity);
        const cost = Number(line.unitCost);
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) {
          throw new Error('Each receipt line needs a positive quantity and a non-negative unit cost.');
        }
        return { partPublicId: line.partPublicId, quantity: qty, unitCost: cost };
      });
      if (new Set(normalized.map((line) => line.partPublicId)).size !== normalized.length) {
        throw new Error('Each SKU can appear only once on a receipt. Combine duplicate rows.');
      }
      const result = await apiFetch<Receipt>('/api/v1/admin/part-receipts', token, {
        method: 'POST',
        body: JSON.stringify({
          supplierPublicId: selectedSupplierId,
          supplierReference: supplierReference.trim() || null,
          idempotencyKey: receiptKey,
          notes: receiptNotes.trim() || null,
          lines: normalized,
        }),
      });
      setLatestReceipt(result);
      setSelectedReceiptId(result.publicId);
      setReceiptLines([{ partPublicId: '', quantity: '1', unitCost: '' }]);
      setSupplierReference('');
      setReceiptNotes('');
      setReceiptKey(newKey());
      setMessage(`Receipt ${result.receiptNumber} saved. ${result.lines.length} stock movement(s) recorded transactionally.`);
      await loadWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Stock receipt could not be saved.');
      // Keep the same idempotency key and body after an unknown-outcome failure for safe retry.
    } finally { setSaving(false); }
  }

  async function loadReceipt(publicId: string) {
    setSelectedReceiptId(publicId);
    setError('');
    try {
      const result = await apiFetch<Receipt>(`/api/v1/admin/part-receipts/${publicId}`, token);
      setLatestReceipt(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Receipt details could not be loaded.');
    }
  }

  function updateReceiptLine(index: number, key: keyof ReceiptLineDraft, value: string) {
    setReceiptLines((current) => current.map((line, lineIndex) =>
      lineIndex === index ? { ...line, [key]: value } : line));
  }

  async function reserveForJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJobCardId || !reservePartId) {
      setError('Choose a job card and a spare part.');
      return;
    }
    const selectedJob = jobCards.find((job) => job.publicId === selectedJobCardId);
    if (!selectedJob || !['APPROVED', 'IN_PROGRESS'].includes(selectedJob.status)) {
      setError('Parts can only be reserved against an approved or in-progress job card.');
      return;
    }
    const amount = Number(reserveQuantity);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a positive reservation quantity.');
      return;
    }
    setOperationBusy('reserve'); setError(''); setMessage('');
    try {
      const reservation = await apiFetch<Reservation>(
        `/api/v1/admin/job-cards/${selectedJobCardId}/part-reservations`, token, {
          method: 'POST',
          body: JSON.stringify({
            partPublicId: reservePartId, quantity: amount,
            idempotencyKey: reserveKey, notes: reserveNotes.trim() || null,
          }),
        });
      setReserveQuantity('1');
      setReserveNotes('');
      setReserveKey(newKey());
      setMessage(`Reservation ${reservation.reservationCode} saved for ${reservation.jobCardCode}.`);
      await Promise.all([loadReservations(selectedJobCardId), loadWorkspace()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Part reservation failed.');
    } finally { setOperationBusy(''); }
  }

  async function processReservation(
    reservation: Reservation, operation: OperationKind) {
    const draft = reservationDrafts[reservation.publicId] ?? { quantity: '1', notes: '' };
    const amount = Number(draft.quantity);
    if (operation !== 'release' && (!Number.isFinite(amount) || amount <= 0)) {
      setError('Enter a positive quantity for this operation.');
      return;
    }
    const slot = `${reservation.publicId}:${operation}`;
    const key = operationKeys[slot] ?? newKey();
    setOperationKeys((current) => current[slot] ? current : { ...current, [slot]: key });
    setOperationBusy(slot); setError(''); setMessage('');
    try {
      let updated: Reservation;
      if (operation === 'release') {
        updated = await apiFetch<Reservation>(
          `/api/v1/admin/part-reservations/${reservation.publicId}/release`, token, {
            method: 'POST', body: JSON.stringify({ idempotencyKey: key, notes: draft.notes.trim() || null }),
          });
      } else {
        updated = await apiFetch<Reservation>(
          `/api/v1/admin/part-reservations/${reservation.publicId}/${operation}`, token, {
            method: 'POST', body: JSON.stringify({
              quantity: amount, idempotencyKey: key, notes: draft.notes.trim() || null,
            }),
          });
      }
      setOperationKeys((current) => ({ ...current, [slot]: newKey() }));
      setMessage(`${prettyStatus(operation)} saved for reservation ${updated.reservationCode}.`);
      await Promise.all([loadReservations(selectedJobCardId), loadWorkspace()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${operation} this reservation.`);
      // Keep the operation key if the outcome is unknown so a retry is idempotent.
    } finally { setOperationBusy(''); }
  }

  function submitPartSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPartQuery(partQueryInput.trim());
  }

  function submitJobCardSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJobCardQuery(jobCardQueryInput.trim());
  }

  if (!staff.permissions.includes('parts.read')) {
    return <section className="module-landing"><div className="module-symbol">▦</div><div className="eyebrow">ACCESS CONTROL</div><h1>Spare parts</h1><p>Your assigned role does not include access to spare-part stock, receipts or job reservations.</p></section>;
  }

  const selectedJobCard = jobCards.find((item) => item.publicId === selectedJobCardId) ?? null;
  const selectedPart = partsList.find((item) => item.publicId === selectedPartId) ?? null;
  const activeReceipt = latestReceipt && (!selectedReceiptId || latestReceipt.publicId === selectedReceiptId)
    ? latestReceipt : null;

  return (
    <section className="spare-parts-workspace">
      <div className="spare-parts-heading">
        <div><div className="eyebrow">CONSUMABLE STOCK & WORKSHOP PARTS</div><h1>Spare parts</h1><p>Track SKU quantities, supplier receipts, reservations, issues and returns separately from individual bike inventory.</p></div>
        <button type="button" className="secondary-button" onClick={() => void loadWorkspace()} disabled={loading}>↻ Refresh</button>
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {message && <div className="notice notice-success" role="status">{message}</div>}
      <div className="spare-parts-tabs" role="tablist" aria-label="Spare parts views">
        <button type="button" className={activeTab === 'stock' ? 'spare-parts-tab active' : 'spare-parts-tab'} onClick={() => setActiveTab('stock')}>Stock & catalogue <span>{partsList.length}</span></button>
        <button type="button" className={activeTab === 'receiving' ? 'spare-parts-tab active' : 'spare-parts-tab'} onClick={() => setActiveTab('receiving')}>Suppliers & receipts <span>{receipts.length}</span></button>
        <button type="button" className={activeTab === 'jobCards' ? 'spare-parts-tab active' : 'spare-parts-tab'} onClick={() => setActiveTab('jobCards')}>Job-card parts <span>{reservations.length}</span></button>
        <button type="button" className={activeTab === 'retail' ? 'spare-parts-tab active' : 'spare-parts-tab'} onClick={() => setActiveTab('retail')}>Customer retail shop</button>
      </div>

      {activeTab === 'retail' && <RetailPartsCommercePanel token={token} staff={staff} />}

      {activeTab === 'stock' && <>
        <div className="spare-parts-panel">
          <div className="spare-parts-section-heading"><div><h2>SKU stock catalogue</h2><p>Available stock is on-hand minus committed reservations. Every change is recorded in the movement ledger.</p></div>{canManageParts && <button type="button" className="primary-button" onClick={() => setShowPartForm((value) => !value)}>{showPartForm ? 'Close form' : '+ New SKU'}</button>}</div>
          <form className="spare-parts-search" onSubmit={submitPartSearch}>
            <input value={partQueryInput} onChange={(event) => setPartQueryInput(event.target.value)} maxLength={100} placeholder="Search SKU or part name" aria-label="Search spare parts" />
            <button type="submit" className="secondary-button">Search</button>
            <button type="button" className="text-button" onClick={() => { setPartQueryInput(''); setPartQuery(''); }}>Clear</button>
          </form>
          {showPartForm && canManageParts && <form className="spare-parts-form" onSubmit={createPart}>
            <div className="spare-parts-form-heading"><h3>Create part SKU</h3><p>Creating the catalogue entry does not create any stock.</p></div>
            <div className="spare-parts-form-grid">
              <label>SKU code *<input required maxLength={60} value={partForm.skuCode} onChange={(event) => setPartForm((current) => ({ ...current, skuCode: event.target.value }))} placeholder="e.g. OIL-FILTER-01" /></label>
              <label>Part name *<input required maxLength={200} value={partForm.partName} onChange={(event) => setPartForm((current) => ({ ...current, partName: event.target.value }))} placeholder="Part description" /></label>
              <label>Unit of measure<select value={partForm.unitOfMeasure} onChange={(event) => setPartForm((current) => ({ ...current, unitOfMeasure: event.target.value }))}>{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
              <label>Description<textarea rows={2} maxLength={1000} value={partForm.description} onChange={(event) => setPartForm((current) => ({ ...current, description: event.target.value }))} /></label>
            </div>
            <div className="spare-parts-form-actions"><button type="button" className="secondary-button" onClick={() => setShowPartForm(false)}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Create SKU'}</button></div>
          </form>}
          {loading ? <div className="studio-empty">Loading parts catalogue…</div> : partsList.length === 0
            ? <div className="studio-empty">No active spare-part SKUs found. Create a SKU, add a supplier, and record a receipt before reserving parts to a job card.</div>
            : <div className="spare-parts-table-wrap"><table className="spare-parts-table"><thead><tr><th>SKU / part</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Average cost</th><th /></tr></thead>
              <tbody>{partsList.map((part) => <tr key={part.publicId} className={selectedPartId === part.publicId ? 'selected' : undefined}>
                <td><strong>{part.skuCode}</strong><span>{part.partName}</span><small>{part.unitOfMeasure}{part.description ? ` · ${part.description}` : ''}</small></td>
                <td>{quantity(part.quantityOnHand)}</td><td>{quantity(part.quantityReserved)}</td><td><strong className={part.quantityAvailable > 0 ? 'available-quantity' : 'zero-quantity'}>{quantity(part.quantityAvailable)}</strong></td><td>{money(part.averageUnitCost)}</td>
                <td><button type="button" className="text-button" onClick={() => setSelectedPartId(part.publicId)}>{selectedPartId === part.publicId ? 'Selected' : 'Movement history'}</button></td>
              </tr>)}</tbody></table></div>}
        </div>
        {selectedPart && <section className="spare-parts-panel spare-parts-movements">
          <div className="spare-parts-section-heading"><div><h2>Movement history · {selectedPart.skuCode}</h2><p>Newest first, including on-hand and reserved snapshots after each operation.</p></div><span className="spare-parts-count">{movements.length} shown</span></div>
          {loadingMovements ? <div className="studio-empty">Loading movement ledger…</div> : movements.length === 0 ? <div className="studio-empty">No stock movements are recorded for this SKU.</div>
            : <div className="spare-movement-list">{movements.map((movement) => <article className="spare-movement-row" key={movement.publicId}>
              <span className={`spare-movement-symbol movement-${movement.movementType.toLowerCase()}`}>{movement.quantityDelta > 0 ? '+' : movement.quantityDelta < 0 ? '−' : '↔'}</span>
              <div className="spare-movement-main"><strong>{prettyStatus(movement.movementType)}</strong><span>{movement.referenceType} · {movement.referenceId}</span><small>{movement.actorName} · {displayDate(movement.createdAt)}</small></div>
              <div className="spare-movement-quantities"><strong>{movement.quantityDelta > 0 ? '+' : ''}{quantity(movement.quantityDelta)} on hand</strong><span>{movement.reservedDelta > 0 ? '+' : ''}{quantity(movement.reservedDelta)} reserved</span><small>Balance {quantity(movement.quantityOnHandAfter)} / {quantity(movement.quantityReservedAfter)}</small></div>
            </article>)}</div>}
        </section>}
      </>}

      {activeTab === 'receiving' && <>
        <div className="spare-parts-two-column">
          <section className="spare-parts-panel">
            <div className="spare-parts-section-heading"><div><h2>Suppliers</h2><p>Supplier references are scoped to this dealership.</p></div>{canManageParts && <button type="button" className="primary-button" onClick={() => setShowSupplierForm((value) => !value)}>{showSupplierForm ? 'Close form' : '+ Add supplier'}</button>}</div>
            {showSupplierForm && canManageParts && <form className="spare-parts-form" onSubmit={createSupplier}>
              <div className="spare-parts-form-grid">
                <label>Supplier code *<input required maxLength={48} value={supplierForm.supplierCode} onChange={(event) => setSupplierForm((current) => ({ ...current, supplierCode: event.target.value }))} /></label>
                <label>Supplier name *<input required maxLength={180} value={supplierForm.supplierName} onChange={(event) => setSupplierForm((current) => ({ ...current, supplierName: event.target.value }))} /></label>
                <label>Contact person<input maxLength={160} value={supplierForm.contactName} onChange={(event) => setSupplierForm((current) => ({ ...current, contactName: event.target.value }))} /></label>
                <label>Phone<input maxLength={32} value={supplierForm.phone} onChange={(event) => setSupplierForm((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label>Email<input type="email" maxLength={320} value={supplierForm.email} onChange={(event) => setSupplierForm((current) => ({ ...current, email: event.target.value }))} /></label>
                <label>Address<input maxLength={1000} value={supplierForm.address} onChange={(event) => setSupplierForm((current) => ({ ...current, address: event.target.value }))} /></label>
              </div>
              <div className="spare-parts-form-actions"><button type="button" className="secondary-button" onClick={() => setShowSupplierForm(false)}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save supplier'}</button></div>
            </form>}
            {suppliers.length === 0 ? <div className="studio-empty">No active suppliers yet.</div> : <div className="spare-supplier-list">
              {suppliers.map((supplier) => <button type="button" key={supplier.publicId} className={selectedSupplierId === supplier.publicId ? 'spare-supplier active' : 'spare-supplier'} onClick={() => setSelectedSupplierId(supplier.publicId)}>
                <span className="supplier-avatar">{supplier.supplierName.trim().slice(0, 1).toUpperCase()}</span><span className="spare-supplier-copy"><strong>{supplier.supplierName}</strong><small>{supplier.supplierCode} · {supplier.phone || supplier.email || 'No contact listed'}</small></span><span className="supplier-select-label">{selectedSupplierId === supplier.publicId ? 'Selected' : 'Select'}</span>
              </button>)}
            </div>}
          </section>

          <section className="spare-parts-panel">
            <div className="spare-parts-section-heading"><div><h2>Receive supplier stock</h2><p>Records on-hand quantity and weighted-average cost in one transaction.</p></div><span className="spare-parts-count">{receiptLines.length} line(s)</span></div>
            {!canReceive && <div className="notice notice-error">Your role can read part stock but cannot receive supplier stock.</div>}
            <form className="spare-parts-form" onSubmit={receiveStock}>
              <label className="spare-full-label">Supplier *
                <select required disabled={!canReceive || suppliers.length === 0} value={selectedSupplierId} onChange={(event) => setSelectedSupplierId(event.target.value)}>
                  <option value="">Choose an active supplier…</option>{suppliers.map((supplier) => <option key={supplier.publicId} value={supplier.publicId}>{supplier.supplierCode} · {supplier.supplierName}</option>)}
                </select>
              </label>
              <div className="spare-parts-form-grid"><label>Purchase / delivery reference<input maxLength={160} value={supplierReference} onChange={(event) => setSupplierReference(event.target.value)} placeholder="Optional supplier note or GRN" /></label><label>Internal receipt note<input maxLength={1000} value={receiptNotes} onChange={(event) => setReceiptNotes(event.target.value)} placeholder="Optional note" /></label></div>
              <div className="spare-receipt-lines">
                {receiptLines.map((line, index) => <div className="spare-receipt-line" key={index}>
                  <label>Part SKU<select required disabled={!canReceive || partsList.length === 0} value={line.partPublicId} onChange={(event) => updateReceiptLine(index, 'partPublicId', event.target.value)}><option value="">Choose SKU…</option>{partsList.map((part) => <option key={part.publicId} value={part.publicId}>{part.skuCode} · {part.partName}</option>)}</select></label>
                  <label>Quantity<input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateReceiptLine(index, 'quantity', event.target.value)} /></label>
                  <label>Unit cost (₹)<input required type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => updateReceiptLine(index, 'unitCost', event.target.value)} /></label>
                  {receiptLines.length > 1 && <button type="button" className="text-button danger-link" onClick={() => setReceiptLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove line</button>}
                </div>)}
              </div>
              <div className="spare-parts-form-actions spare-receipt-actions">
                <button type="button" className="secondary-button" disabled={receiptLines.length >= 100} onClick={() => setReceiptLines((current) => [...current, { partPublicId: '', quantity: '1', unitCost: '' }])}>+ Add line</button>
                <button type="submit" className="primary-button" disabled={!canReceive || saving || !selectedSupplierId || partsList.length === 0}>{saving ? 'Recording…' : 'Record stock receipt'}</button>
              </div>
              <small className="spare-idempotency-note">Receipt key is retained after an unknown-outcome error. Retry with the same lines to avoid duplicate stock receipt.</small>
            </form>
            {activeReceipt && <div className="spare-receipt-result">
              <div><strong>Receipt {activeReceipt.receiptNumber}</strong><span>{activeReceipt.supplierName} · {displayDate(activeReceipt.receivedAt)}</span><strong>{money(activeReceipt.totalCost)}</strong></div>
              {activeReceipt.lines.map((line) => <p key={line.lineNumber}><span>{line.skuCode} · {line.partName}</span><span>{quantity(line.quantity)} × {money(line.unitCost)} = {money(line.lineTotal)}</span></p>)}
            </div>}
          </section>
        </div>

        <section className="spare-parts-panel">
          <div className="spare-parts-section-heading"><div><h2>Recent purchase receipts</h2><p>Receipts are immutable operational records; corrections require a separate reversal flow.</p></div><span className="spare-parts-count">{receipts.length} recent</span></div>
          {receipts.length === 0 ? <div className="studio-empty">No supplier receipts yet.</div> : <div className="spare-parts-table-wrap"><table className="spare-parts-table"><thead><tr><th>Receipt</th><th>Supplier</th><th>Received</th><th>Recorded cost</th><th /></tr></thead><tbody>
            {receipts.map((receipt) => <tr key={receipt.publicId} className={selectedReceiptId === receipt.publicId ? 'selected' : undefined}>
              <td><strong>{receipt.receiptNumber}</strong><span>{receipt.supplierReference || receipt.status}</span></td><td>{receipt.supplierName}<small>{receipt.receivedByName}</small></td><td>{displayDate(receipt.receivedAt)}</td><td>{money(receipt.totalCost)}</td><td><button type="button" className="text-button" onClick={() => void loadReceipt(receipt.publicId)}>View</button></td>
            </tr>)}
          </tbody></table></div>}
        </section>
      </>}

      {activeTab === 'jobCards' && <>
        <section className="spare-parts-panel">
          <div className="spare-parts-section-heading"><div><h2>Job-card parts</h2><p>Reserve stock after estimate approval. Issues reduce on-hand quantity; returns and releases are audited separately.</p></div></div>
          <form className="spare-parts-search" onSubmit={submitJobCardSearch}>
            <input value={jobCardQueryInput} onChange={(event) => setJobCardQueryInput(event.target.value)} maxLength={100} placeholder="Search job code, customer, bike or chassis" aria-label="Search workshop job cards" />
            <button type="submit" className="secondary-button">Search jobs</button>
            <button type="button" className="text-button" onClick={() => { setJobCardQueryInput(''); setJobCardQuery(''); }}>Clear</button>
          </form>
          <label className="spare-full-label">Select job card *
            <select value={selectedJobCardId} onChange={(event) => setSelectedJobCardId(event.target.value)}>
              <option value="">Choose a workshop job card…</option>
              {jobCards.map((job) => <option key={job.publicId} value={job.publicId}>{job.jobCardCode} · {job.customerName} · {job.status}</option>)}
            </select>
          </label>
          {selectedJobCard && <div className="spare-selected-job"><div><span>{selectedJobCard.jobCardCode}</span><strong>{selectedJobCard.customerName}</strong><small>{selectedJobCard.modelName}{selectedJobCard.variantName ? ` · ${selectedJobCard.variantName}` : ''} · {selectedJobCard.chassisNumber}</small></div><span className={`campaign-status status-${selectedJobCard.status.toLowerCase()}`}>{prettyStatus(selectedJobCard.status)}</span></div>}
          {!selectedJobCard && <div className="studio-empty">No job card selected. Workshop reservations stay scoped to this dealership.</div>}
          {selectedJobCard && canReserve && ['APPROVED', 'IN_PROGRESS'].includes(selectedJobCard.status) && <form className="spare-reserve-form" onSubmit={reserveForJob}>
            <div className="spare-parts-form-heading"><h3>Reserve parts for this job</h3><p>Reservation reduces available stock but does not yet reduce physical on-hand stock.</p></div>
            <div className="spare-parts-form-grid">
              <label>Part SKU *<select required value={reservePartId} onChange={(event) => setReservePartId(event.target.value)}><option value="">Choose part…</option>{partsList.filter((part) => part.active).map((part) => <option key={part.publicId} value={part.publicId}>{part.skuCode} · {part.partName} · available {quantity(part.quantityAvailable)}</option>)}</select></label>
              <label>Quantity *<input type="number" required min="0.001" step="0.001" value={reserveQuantity} onChange={(event) => setReserveQuantity(event.target.value)} /></label>
              <label className="spare-full-label">Reservation note<input maxLength={1000} value={reserveNotes} onChange={(event) => setReserveNotes(event.target.value)} placeholder="Optional repair context" /></label>
            </div>
            <div className="spare-parts-form-actions"><span className="spare-idempotency-note">Reservation uses an idempotency key for safe retry.</span><button type="submit" className="primary-button" disabled={operationBusy === 'reserve' || !reservePartId || partsList.length === 0}>{operationBusy === 'reserve' ? 'Reserving…' : 'Reserve stock'}</button></div>
          </form>}
          {selectedJobCard && canReserve && !['APPROVED', 'IN_PROGRESS'].includes(selectedJobCard.status) && <div className="workshop-next-stage">Reservations are locked for job cards in {prettyStatus(selectedJobCard.status)} status.</div>}
          {selectedJobCard && !canReserve && <div className="workshop-field-hint">Your role can view reservations but cannot reserve or release stock.</div>}
        </section>

        <section className="spare-parts-panel">
          <div className="spare-parts-section-heading"><div><h2>Reservation history</h2><p>Released quantity is excluded from remaining-to-issue. Returned parts are added back to physical stock.</p></div><span className="spare-parts-count">{reservations.length} reservation(s)</span></div>
          {loadingReservations ? <div className="studio-empty">Loading job-card reservations…</div>
            : reservations.length === 0 ? <div className="studio-empty">No parts have been reserved for this job card.</div>
            : <div className="spare-reservation-list">{reservations.map((reservation) => {
              const draft = reservationDrafts[reservation.publicId] ?? { quantity: '1', notes: '' };
              const canIssueThis = canIssue && selectedJobCard?.status === 'IN_PROGRESS'
                && ['OPEN', 'PARTIALLY_ISSUED'].includes(reservation.status)
                && reservation.quantityRemainingToIssue > 0;
              const canReturnThis = canReturn && selectedJobCard?.status === 'IN_PROGRESS'
                && reservation.quantityIssued > reservation.quantityReturned;
              const canReleaseThis = canReserve && ['APPROVED', 'IN_PROGRESS'].includes(selectedJobCard?.status ?? '')
                && ['OPEN', 'PARTIALLY_ISSUED'].includes(reservation.status)
                && reservation.quantityRemainingToIssue > 0;
              return <article className="spare-reservation-card" key={reservation.publicId}>
                <div className="spare-reservation-heading"><div><strong>{reservation.reservationCode} · {reservation.skuCode}</strong><span>{reservation.partName} · {reservation.quantityReserved} {reservation.unitOfMeasure} reserved</span><small>{reservation.jobCardCode} · unit cost snapshot {money(reservation.unitCostSnapshot)} · {displayDate(reservation.createdAt)}</small></div><span className={`campaign-status status-${reservation.status.toLowerCase()}`}>{prettyStatus(reservation.status)}</span></div>
                <div className="spare-reservation-quantities"><div><span>Issued</span><strong>{quantity(reservation.quantityIssued)}</strong></div><div><span>Returned</span><strong>{quantity(reservation.quantityReturned)}</strong></div><div><span>Released</span><strong>{quantity(reservation.quantityReleased)}</strong></div><div><span>Remaining to issue</span><strong>{quantity(reservation.quantityRemainingToIssue)}</strong></div></div>
                {(canIssueThis || canReturnThis || canReleaseThis) && <div className="spare-reservation-actions">
                  <label>Quantity<input type="number" min="0.001" step="0.001" value={draft.quantity} onChange={(event) => setReservationDrafts((current) => ({ ...current, [reservation.publicId]: { ...draft, quantity: event.target.value } }))} /></label>
                  <label>Operation note<input maxLength={1000} value={draft.notes} onChange={(event) => setReservationDrafts((current) => ({ ...current, [reservation.publicId]: { ...draft, notes: event.target.value } }))} placeholder="Optional reason / context" /></label>
                  {canIssueThis && <button type="button" className="subtle-action receive-action-button" disabled={operationBusy === `${reservation.publicId}:issue`} onClick={() => void processReservation(reservation, 'issue')}>{operationBusy === `${reservation.publicId}:issue` ? 'Issuing…' : 'Issue quantity'}</button>}
                  {canReturnThis && <button type="button" className="subtle-action" disabled={operationBusy === `${reservation.publicId}:return`} onClick={() => void processReservation(reservation, 'return')}>{operationBusy === `${reservation.publicId}:return` ? 'Returning…' : 'Return quantity'}</button>}
                  {canReleaseThis && <button type="button" className="text-button danger-link" disabled={operationBusy === `${reservation.publicId}:release`} onClick={() => void processReservation(reservation, 'release')}>{operationBusy === `${reservation.publicId}:release` ? 'Releasing…' : 'Release remaining quantity'}</button>}
                </div>}
              </article>;
            })}</div>}
        </section>
      </>}
    </section>
  );
}
