import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../apiClient';
import type { StaffSummary } from '../auth/StaffLogin';

type VehicleModel = {
  publicId: string; modelCode: string; modelName: string; variantName: string | null;
  colourName: string | null; modelYear: number | null; active: boolean;
  expectedCount: number; availableCount: number; reservedCount: number; soldCount: number;
};
type CatalogueModel = {
  modelCode: string; modelName: string; family: string; category: string;
  published: boolean; markedOutOfStock: boolean; expectedAvailableOn: string | null;
  internalNote: string | null; updatedAt: string | null;
  availableUnits: number; expectedUnits: number; reservedUnits: number;
};
type CatalogueDraft = {
  published: boolean; markedOutOfStock: boolean; expectedAvailableOn: string; internalNote: string;
};
type VehicleUnit = {
  publicId: string; modelPublicId: string; modelCode: string; modelName: string;
  variantName: string | null; colourName: string | null; chassisNumber: string;
  engineNumber: string; stockStatus: string; supplierReference: string | null;
  purchaseCost: number | null; receivedAt: string | null; createdAt: string;
};
type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
type ModelForm = { modelCode: string; modelName: string; variantName: string; colourName: string; modelYear: string };
type UnitForm = { modelPublicId: string; chassisNumber: string; engineNumber: string; supplierReference: string; purchaseCost: string };

const emptyModel: ModelForm = { modelCode: '', modelName: '', variantName: '', colourName: '', modelYear: '' };
const emptyUnit: UnitForm = { modelPublicId: '', chassisNumber: '', engineNumber: '', supplierReference: '', purchaseCost: '' };

export default function VehicleInventoryWorkspace({ token, staff }: { token: string; staff: StaffSummary }) {
  const canManage = staff.permissions.includes('vehicle.manage');
  const canReadCatalogue = staff.permissions.includes('catalogue.read');
  const canManageCatalogue = staff.permissions.includes('catalogue.manage');
  const [activeTab, setActiveTab] = useState<'models' | 'units'>('units');
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [units, setUnits] = useState<VehicleUnit[]>([]);
  const [catalogueModels, setCatalogueModels] = useState<CatalogueModel[]>([]);
  const [catalogueDrafts, setCatalogueDrafts] = useState<Record<string, CatalogueDraft>>({});
  const [modelForm, setModelForm] = useState<ModelForm>(emptyModel);
  const [unitForm, setUnitForm] = useState<UnitForm>(emptyUnit);
  const [showModelForm, setShowModelForm] = useState(false);
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [receiptRefs, setReceiptRefs] = useState<Record<string, string>>({});
  const [receivingId, setReceivingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refresh = useCallback(async (searchValue = activeSearch) => {
    setLoading(true);
    setError('');
    try {
      const modelParams = new URLSearchParams({ page: '0', pageSize: '100' });
      if (searchValue) modelParams.set('q', searchValue);
      const [modelPage, unitPage, catalogueResult] = await Promise.all([
        apiFetch<Page<VehicleModel>>(`/api/v1/admin/vehicle-models?${modelParams.toString()}`, token),
        apiFetch<Page<VehicleUnit>>('/api/v1/admin/vehicle-units?page=0&pageSize=100', token),
        canReadCatalogue
          ? apiFetch<{ models: CatalogueModel[] }>('/api/v1/admin/catalogue/models', token)
          : Promise.resolve(null),
      ]);
      setModels(modelPage.items);
      setUnits(unitPage.items);
      if (catalogueResult) {
        setCatalogueModels(catalogueResult.models ?? []);
        setCatalogueDrafts(Object.fromEntries((catalogueResult.models ?? []).map((model) => [model.modelCode, {
          published: model.published, markedOutOfStock: model.markedOutOfStock,
          expectedAvailableOn: model.expectedAvailableOn ?? '', internalNote: model.internalNote ?? '',
        }])));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load vehicle inventory.');
    } finally {
      setLoading(false);
    }
  }, [token, activeSearch, canReadCatalogue]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function createModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    try {
      await apiFetch<VehicleModel>('/api/v1/admin/vehicle-models', token, {
        method: 'POST',
        body: JSON.stringify({
          ...modelForm,
          modelCode: modelForm.modelCode.trim().toUpperCase(),
          modelName: modelForm.modelName.trim(),
          variantName: modelForm.variantName.trim() || null,
          colourName: modelForm.colourName.trim() || null,
          modelYear: modelForm.modelYear ? Number(modelForm.modelYear) : null,
        }),
      });
      setModelForm(emptyModel); setShowModelForm(false);
      setSuccess('Vehicle model saved.');
      await refresh('');
      setModelSearch(''); setActiveSearch('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save vehicle model.');
    } finally { setSaving(false); }
  }

  async function registerUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    try {
      await apiFetch<VehicleUnit>('/api/v1/admin/vehicle-units', token, {
        method: 'POST',
        body: JSON.stringify({
          modelPublicId: unitForm.modelPublicId,
          chassisNumber: unitForm.chassisNumber.trim(),
          engineNumber: unitForm.engineNumber.trim(),
          supplierReference: unitForm.supplierReference.trim() || null,
          purchaseCost: unitForm.purchaseCost ? Number(unitForm.purchaseCost) : null,
        }),
      });
      setUnitForm(emptyUnit); setShowUnitForm(false);
      setSuccess('Vehicle recorded as expected stock. Receive it only after physically verifying delivery.');
      await refresh();
      setActiveTab('units');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to register vehicle stock.');
    } finally { setSaving(false); }
  }

  async function receiveUnit(unit: VehicleUnit) {
    setReceivingId(unit.publicId); setError(''); setSuccess('');
    try {
      await apiFetch<VehicleUnit>(`/api/v1/admin/vehicle-units/${unit.publicId}/receive`, token, {
        method: 'POST',
        body: JSON.stringify({ receiptReference: receiptRefs[unit.publicId]?.trim() || null, reason: 'Stock received and chassis/engine verified.' }),
      });
      setSuccess(`${unit.modelName} received into available stock.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to receive this vehicle.');
    } finally { setReceivingId(''); }
  }

  function updateCatalogueDraft(modelCode: string, patch: Partial<CatalogueDraft>) {
    setCatalogueDrafts((current) => ({
      ...current,
      [modelCode]: {
        ...(current[modelCode] ?? { published: false, markedOutOfStock: false, expectedAvailableOn: '', internalNote: '' }),
        ...patch,
      },
    }));
  }

  async function saveCatalogueSettings(modelCode: string) {
    if (!canManageCatalogue) return;
    const draft = catalogueDrafts[modelCode];
    if (!draft) return;
    if (!draft.markedOutOfStock && draft.expectedAvailableOn) {
      setError('Set an expected date only when the model is marked out of stock.');
      return;
    }
    setSaving(true); setError(''); setSuccess('');
    try {
      const saved = await apiFetch<CatalogueModel>(
        `/api/v1/admin/catalogue/models/${encodeURIComponent(modelCode)}`, token, {
          method: 'PUT',
          body: JSON.stringify({
            published: draft.published, markedOutOfStock: draft.markedOutOfStock,
            expectedAvailableOn: draft.expectedAvailableOn || null,
            internalNote: draft.internalNote.trim() || null,
          }),
        });
      setCatalogueModels((current) => current.map((model) => model.modelCode === modelCode ? saved : model));
      setCatalogueDrafts((current) => ({ ...current, [modelCode]: {
        published: saved.published, markedOutOfStock: saved.markedOutOfStock,
        expectedAvailableOn: saved.expectedAvailableOn ?? '', internalNote: saved.internalNote ?? '',
      }}));
      setSuccess(`${saved.modelName}: showroom settings saved.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update showroom publication or availability.');
    } finally {
      setSaving(false);
    }
  }

  function searchModels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = modelSearch.trim();
    setActiveSearch(next);
  }

  // Aggregate counts come from the model stock summaries, not the first paginated
  // unit rows, so the figures remain correct when an outlet has more than 100 bikes.
  const availableCount = models.reduce((sum, model) => sum + model.availableCount, 0);
  const expectedCount = models.reduce((sum, model) => sum + model.expectedCount, 0);
  const reservedCount = models.reduce((sum, model) => sum + model.reservedCount, 0);
  const soldCount = models.reduce((sum, model) => sum + model.soldCount, 0);

  if (!staff.permissions.includes('vehicle.read')) {
    return <section className="module-landing"><div className="module-symbol">▤</div><div className="eyebrow">ACCESS CONTROL</div><h1>Bike inventory</h1><p>Your assigned role does not include access to vehicle stock.</p></section>;
  }

  return (
    <section className="inventory-workspace">
      <div className="inventory-heading">
        <div><div className="eyebrow">VEHICLE & STOCK CONTROL</div><h1>Bike inventory</h1><p>Track the model catalogue and every individual vehicle by its identifying numbers.</p></div>
        {canManage && <div className="inventory-actions">
          <button className="secondary-button" type="button" onClick={() => { setShowModelForm((v) => !v); setShowUnitForm(false); setError(''); }}>{showModelForm ? 'Close model form' : '+ Add model'}</button>
          <button className="primary-button" type="button" onClick={() => { setShowUnitForm((v) => !v); setShowModelForm(false); setError(''); }}>{showUnitForm ? 'Close vehicle form' : '+ Register vehicle'}</button>
        </div>}
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {success && <div className="notice notice-success" role="status">{success}</div>}

      {showModelForm && canManage && <form className="customer-form-card" onSubmit={createModel}>
        <div className="form-card-heading"><div><h2>Add vehicle model</h2><p>Use the manufacturer model/variant as printed in your authorised inventory records.</p></div><span className="form-step">MODEL CATALOGUE</span></div>
        <div className="customer-form-grid">
          <label>Model code *<input required maxLength={60} value={modelForm.modelCode} onChange={(e) => setModelForm((v) => ({ ...v, modelCode: e.target.value }))} placeholder="e.g. PULSAR-150" /></label>
          <label>Model name *<input required maxLength={160} value={modelForm.modelName} onChange={(e) => setModelForm((v) => ({ ...v, modelName: e.target.value }))} placeholder="e.g. Pulsar 150" /></label>
          <label>Variant<input maxLength={120} value={modelForm.variantName} onChange={(e) => setModelForm((v) => ({ ...v, variantName: e.target.value }))} placeholder="Optional" /></label>
          <label>Colour<input maxLength={80} value={modelForm.colourName} onChange={(e) => setModelForm((v) => ({ ...v, colourName: e.target.value }))} placeholder="Optional" /></label>
          <label>Model year<input type="number" min={1990} max={2200} value={modelForm.modelYear} onChange={(e) => setModelForm((v) => ({ ...v, modelYear: e.target.value }))} placeholder="Optional" /></label>
        </div>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowModelForm(false)}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save model'}</button></div>
      </form>}

      {showUnitForm && canManage && <form className="customer-form-card" onSubmit={registerUnit}>
        <div className="form-card-heading"><div><h2>Register expected vehicle</h2><p>This creates a pending stock record. It does not become available until the receiving step is completed.</p></div><span className="form-step">INDIVIDUAL VEHICLE</span></div>
        <div className="customer-form-grid">
          <label className="field-span-two">Vehicle model *<select required value={unitForm.modelPublicId} onChange={(e) => setUnitForm((v) => ({ ...v, modelPublicId: e.target.value }))}><option value="">Choose model…</option>{models.filter((model) => model.active).map((model) => <option key={model.publicId} value={model.publicId}>{model.modelName}{model.variantName ? ` · ${model.variantName}` : ''}{model.colourName ? ` · ${model.colourName}` : ''}</option>)}</select></label>
          <label>Chassis number (VIN) *<input required maxLength={100} value={unitForm.chassisNumber} onChange={(e) => setUnitForm((v) => ({ ...v, chassisNumber: e.target.value }))} placeholder="Enter exact chassis/VIN" /></label>
          <label>Engine number *<input required maxLength={100} value={unitForm.engineNumber} onChange={(e) => setUnitForm((v) => ({ ...v, engineNumber: e.target.value }))} placeholder="Enter exact engine number" /></label>
          <label>Purchase reference<input maxLength={120} value={unitForm.supplierReference} onChange={(e) => setUnitForm((v) => ({ ...v, supplierReference: e.target.value }))} placeholder="PO / supplier reference" /></label>
          <label>Purchase cost (₹)<input type="number" min="0" step="0.01" value={unitForm.purchaseCost} onChange={(e) => setUnitForm((v) => ({ ...v, purchaseCost: e.target.value }))} placeholder="Optional" /></label>
        </div>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowUnitForm(false)}>Cancel</button><button type="submit" className="primary-button" disabled={saving || models.length === 0}>{saving ? 'Saving…' : 'Register expected stock'}</button></div>
      </form>}

      <div className="inventory-metrics">
        {[['Available', availableCount, 'available'], ['Expected', expectedCount, 'expected'], ['Reserved', reservedCount, 'reserved'], ['Sold', soldCount, 'sold']].map(([label, count, tone]) => (
          <article key={String(label)} className="inventory-metric"><span className={`inventory-metric-icon ${tone}`}>{label === 'Available' ? '✓' : label === 'Expected' ? '↗' : label === 'Reserved' ? '◷' : '▤'}</span><div><span>{label}</span><strong>{Number(count).toLocaleString('en-IN')}</strong></div></article>
        ))}
      </div>

      <div className="inventory-table-card">
        <div className="inventory-tabs">
          <button type="button" className={activeTab === 'units' ? 'inventory-tab active' : 'inventory-tab'} onClick={() => setActiveTab('units')}>Individual vehicles <span>{units.length}</span></button>
          <button type="button" className={activeTab === 'models' ? 'inventory-tab active' : 'inventory-tab'} onClick={() => setActiveTab('models')}>Model catalogue <span>{models.length}</span></button>
          {activeTab === 'models' && <form className="search-form inventory-search" onSubmit={searchModels}><input aria-label="Search models" value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder="Search models, variants or colours" /><button type="submit" className="secondary-button">Search</button></form>}
        </div>
        <div className="customer-table-scroll">
          {activeTab === 'units' ? <table className="customer-table inventory-table">
            <thead><tr><th>Vehicle / model</th><th>Chassis number</th><th>Engine number</th><th>Status</th><th>Received</th>{canManage && <th>Action</th>}</tr></thead>
            <tbody>{loading ? <tr><td colSpan={canManage ? 6 : 5} className="table-empty">Loading inventory…</td></tr>
              : units.length === 0 ? <tr><td colSpan={canManage ? 6 : 5} className="table-empty">No vehicle stock has been registered yet.</td></tr>
              : units.map((unit) => <tr key={unit.publicId}>
                <td><div className="customer-name-cell"><span className="vehicle-model-mark">B</span><div><strong>{unit.modelName}</strong><span>{[unit.variantName, unit.colourName, unit.modelCode].filter(Boolean).join(' · ')}</span></div></div></td>
                <td className="vehicle-serial">{unit.chassisNumber}</td><td className="vehicle-serial">{unit.engineNumber}</td>
                <td><span className={`status-chip status-${unit.stockStatus.toLowerCase()}`}>{unit.stockStatus}</span></td>
                <td className="date-cell">{unit.receivedAt ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(unit.receivedAt)) : 'Not received'}</td>
                {canManage && <td>{unit.stockStatus === 'EXPECTED' ? <div className="receive-action"><input aria-label={`Receipt reference for ${unit.chassisNumber}`} placeholder="Receipt ref (optional)" maxLength={120} value={receiptRefs[unit.publicId] ?? ''} onChange={(e) => setReceiptRefs((v) => ({ ...v, [unit.publicId]: e.target.value }))} /><button className="receive-button" type="button" disabled={receivingId === unit.publicId} onClick={() => void receiveUnit(unit)}>{receivingId === unit.publicId ? 'Receiving…' : 'Receive'}</button></div> : <span className="muted-action">—</span>}</td>}
              </tr>)}
            </tbody>
          </table> : <table className="customer-table inventory-table">
            <thead><tr><th>Model</th><th>Model code</th><th>Variant / colour</th><th>Expected</th><th>Available</th><th>Reserved</th><th>Sold</th></tr></thead>
            <tbody>{loading ? <tr><td colSpan={7} className="table-empty">Loading model catalogue…</td></tr>
              : models.length === 0 ? <tr><td colSpan={7} className="table-empty">No models found. Add a model before registering vehicles.</td></tr>
              : models.map((model) => <tr key={model.publicId}><td><div className="customer-name-cell"><span className="vehicle-model-mark">B</span><div><strong>{model.modelName}</strong><span>{model.modelYear ?? 'Model year not set'}</span></div></div></td><td className="vehicle-serial">{model.modelCode}</td><td>{[model.variantName, model.colourName].filter(Boolean).join(' · ') || '—'}</td><td>{model.expectedCount}</td><td><strong className="stock-available-count">{model.availableCount}</strong></td><td>{model.reservedCount}</td><td>{model.soldCount}</td></tr>)}
            </tbody>
          </table>}
        </div>
        <div className="inventory-footnote"><span className="status-dot" /> Stock totals are from saved vehicle-unit records. Reservation and sale transitions are enabled only through the corresponding verified sales workflow.</div>
      </div>
      {canReadCatalogue && <section className="inventory-table-card showroom-admin-card">
        <div className="showroom-admin-heading">
          <div><div className="eyebrow">PUBLIC SHOWROOM CONTROL</div><h2>Bajaj catalogue visibility</h2>
            <p>Publish models individually and manage an out-of-stock forecast. Forecasts never add physical stock.</p></div>
          <span className="inventory-count-pill">{catalogueModels.filter((model) => catalogueDrafts[model.modelCode]?.published ?? model.published).length} published</span>
        </div>
        {!canManageCatalogue && <div className="inventory-footnote">Your role can view this catalogue. Publishing and restock forecasts require catalogue management permission.</div>}
        <div className="customer-table-scroll">
          <table className="customer-table inventory-table showroom-admin-table">
            <thead><tr><th>Bajaj model</th><th>Physical stock</th><th>Publish</th><th>Out-of-stock forecast</th><th>Internal note</th><th>Save</th></tr></thead>
            <tbody>
              {catalogueModels.map((model) => {
                const draft = catalogueDrafts[model.modelCode] ?? {
                  published: model.published, markedOutOfStock: model.markedOutOfStock,
                  expectedAvailableOn: model.expectedAvailableOn ?? '', internalNote: model.internalNote ?? '',
                };
                const formId = `catalogue-settings-${model.modelCode.replace(/[^A-Za-z0-9_-]/g, '-')}`;
                return <tr key={model.modelCode}>
                  <td><div className="customer-name-cell"><span className="vehicle-model-mark">B</span><div><strong>{model.modelName}</strong><span>{model.family} · {model.category}</span><small className="vehicle-serial">{model.modelCode}</small></div></div></td>
                  <td><div className="showroom-stock-facts"><strong>{model.availableUnits} available</strong><span>{model.expectedUnits} expected · {model.reservedUnits} reserved</span>
                    <span className={model.availableUnits > 0 ? 'showroom-state showroom-state-in' : draft.expectedAvailableOn ? 'showroom-state' : 'showroom-state showroom-state-out'}>{model.availableUnits > 0 ? 'IN STOCK' : draft.expectedAvailableOn ? 'EXPECTED' : model.expectedUnits > 0 ? 'EXPECTED · DATE TBD' : 'OUT OF STOCK'}</span></div></td>
                  <td><label className="showroom-publish-control"><input form={formId} aria-label={`Publish ${model.modelName} to public showroom`} type="checkbox" checked={draft.published} disabled={!canManageCatalogue || saving} onChange={(event) => updateCatalogueDraft(model.modelCode, { published: event.target.checked })} /><span>{draft.published ? 'Published' : 'Unpublished'}</span></label></td>
                  <td><div className="showroom-forecast-fields">
                    <label><input form={formId} type="checkbox" aria-label={`Mark ${model.modelName} out of stock`} checked={draft.markedOutOfStock} disabled={!canManageCatalogue || saving || model.availableUnits > 0} onChange={(event) => updateCatalogueDraft(model.modelCode, { markedOutOfStock: event.target.checked, expectedAvailableOn: event.target.checked ? draft.expectedAvailableOn : '' })} /> Mark out of stock</label>
                    <label className="showroom-expected-date">Expected availability
                      <input form={formId} type="date" value={draft.expectedAvailableOn} min={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} disabled={!canManageCatalogue || saving || !draft.markedOutOfStock} onChange={(event) => updateCatalogueDraft(model.modelCode, { expectedAvailableOn: event.target.value })} />
                    </label>
                    {model.availableUnits > 0 && <small className="showroom-field-help">Physical stock is available. Use inventory workflows to correct stock first.</small>}
                  </div></td>
                  <td><textarea form={formId} aria-label={`Internal stock note for ${model.modelName}`} maxLength={500} rows={2} value={draft.internalNote} disabled={!canManageCatalogue || saving} onChange={(event) => updateCatalogueDraft(model.modelCode, { internalNote: event.target.value })} placeholder="Internal note (not public)" /></td>
                  <td>{canManageCatalogue ? <form id={formId} onSubmit={(event) => { event.preventDefault(); void saveCatalogueSettings(model.modelCode); }}>
                    <button type="submit" className="secondary-button showroom-save-row" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                  </form> : '—'}</td>
                </tr>;
              })}
              {catalogueModels.length === 0 && <tr><td colSpan={6} className="table-empty">No Bajaj catalogue records are available.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="inventory-footnote"><span className="status-dot" /> Publish controls only affect public visibility. Physical availability remains sourced from received vehicle units. Expected date and internal note are dealership-maintained forecasts; only the expected date is public.</div>
      </section>}
    </section>
  );
}
