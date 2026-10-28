import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../apiClient';

type RegistrationType = '' | 'REGULAR' | 'COMPOSITION' | 'SEZ' | 'UNREGISTERED';
type Applicability = 'NOT_ASSESSED' | 'APPLICABLE' | 'NOT_APPLICABLE';
type Profile = {
  registrationType: string | null; gstin: string | null; legalName: string | null; tradeName: string | null;
  registeredAddress: string | null; stateCode: string | null; eInvoiceApplicability: string;
  assessedFinancialYear: string | null; applicabilityAssessmentNote: string | null;
  assessedByName: string | null; updatedAt: string | null;
};
type Readiness = { status: string; verifiedTaxCodeCount: number; draftTaxCodeCount: number;
  irpIntegrationStatus: string; note: string };
type TaxCode = { publicId: string; code: string; description: string; hsnSacCode: string; supplyType: string;
  gstRate: number | string; cessRate: number | string; effectiveFrom: string; effectiveTo: string | null;
  sourceReference: string | null; status: 'DRAFT' | 'VERIFIED'; verificationNote: string | null;
  createdByName: string; verifiedByName: string | null; createdAt: string; verifiedAt: string | null };
type Props = { token: string; permissions: string[] };
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const moneyRate=(value:number|string)=>Number(value).toLocaleString('en-IN',{maximumFractionDigits:2})+'%';
const dateLabel=(value:string|null|undefined)=>value?new Intl.DateTimeFormat('en-IN',{dateStyle:'medium'}).format(new Date(value)):'—';

export default function TaxReadinessWorkspace({token,permissions}:Props) {
  const [readiness,setReadiness]=useState<Readiness|null>(null);
  const [codes,setCodes]=useState<TaxCode[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [profileForm,setProfileForm]=useState({registrationType:'' as RegistrationType,gstin:'',legalName:'',tradeName:'',
    registeredAddress:'',stateCode:'',eInvoiceApplicability:'NOT_ASSESSED' as Applicability,assessedFinancialYear:'',applicabilityAssessmentNote:''});
  const [codeForm,setCodeForm]=useState({code:'',description:'',hsnSacCode:'',supplyType:'GOODS',gstRate:'',cessRate:'0',
    effectiveFrom:today(),effectiveTo:'',sourceReference:''});
  const [verifyId,setVerifyId]=useState<string|null>(null);
  const [verificationNote,setVerificationNote]=useState('');
  const canManage=permissions.includes('settings.manage');

  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try {
      const [p,r,c]=await Promise.all([
        apiFetch<Profile>('/api/v1/admin/finance/tax-profile',token),
        apiFetch<Readiness>('/api/v1/admin/finance/tax-readiness',token),
        apiFetch<TaxCode[]>('/api/v1/admin/finance/tax-codes',token)
      ]);
      setReadiness(r);setCodes(c);
      setProfileForm({
        registrationType:(p.registrationType??'') as RegistrationType,gstin:p.gstin??'',legalName:p.legalName??'',
        tradeName:p.tradeName??'',registeredAddress:p.registeredAddress??'',stateCode:p.stateCode??'',
        eInvoiceApplicability:(p.eInvoiceApplicability??'NOT_ASSESSED') as Applicability,
        assessedFinancialYear:p.assessedFinancialYear??'',applicabilityAssessmentNote:p.applicabilityAssessmentNote??''
      });
    } catch(e) {setError(e instanceof Error?e.message:'Tax readiness configuration could not be loaded.');}
    finally {setLoading(false);}
  },[token]);
  useEffect(()=>{void refresh();},[refresh]);

  async function saveProfile(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setSaving(true);setError('');setNotice('');
    try {
      await apiFetch<Profile>('/api/v1/admin/finance/tax-profile',token,{method:'PUT',body:JSON.stringify({
        ...profileForm,gstin:profileForm.gstin.trim()||null,legalName:profileForm.legalName.trim()||null,
        tradeName:profileForm.tradeName.trim()||null,registeredAddress:profileForm.registeredAddress.trim()||null,
        stateCode:profileForm.stateCode.trim()||null,assessedFinancialYear:profileForm.assessedFinancialYear.trim()||null,
        applicabilityAssessmentNote:profileForm.applicabilityAssessmentNote.trim()||null
      })});
      setNotice('Tax profile saved. This stores your configuration only; it does not issue a tax invoice or verify registration with GSTN.');
      await refresh();
    } catch(e) {setError(e instanceof Error?e.message:'Tax profile could not be saved.');}
    finally {setSaving(false);}
  }

  async function createCode(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setSaving(true);setError('');setNotice('');
    try {
      await apiFetch<TaxCode>('/api/v1/admin/finance/tax-codes',token,{method:'POST',body:JSON.stringify({
        ...codeForm,gstRate:Number(codeForm.gstRate),cessRate:Number(codeForm.cessRate||'0'),
        effectiveTo:codeForm.effectiveTo||null,sourceReference:codeForm.sourceReference.trim()||null
      })});
      setCodeForm({code:'',description:'',hsnSacCode:'',supplyType:'GOODS',gstRate:'',cessRate:'0',
        effectiveFrom:today(),effectiveTo:'',sourceReference:''});
      setNotice('Tax code saved as Draft. It is not used to calculate or print any invoice.');
      await refresh();
    } catch(e) {setError(e instanceof Error?e.message:'Tax code could not be saved.');}
    finally {setSaving(false);}
  }

  async function verifyCode(code:TaxCode) {
    if(!code.sourceReference?.trim()) {setError('Add a source reference before marking a tax code verified.');return;}
    if(!verificationNote.trim()||verificationNote.trim().length<3) {setError('Enter the basis of review before confirming verification.');return;}
    setSaving(true);setError('');setNotice('');
    try {
      await apiFetch<TaxCode>('/api/v1/admin/finance/tax-codes/'+code.publicId+'/verify',token,{method:'POST',
        body:JSON.stringify({sourceReference:code.sourceReference,verificationNote:verificationNote.trim()})});
      setVerifyId(null);setVerificationNote('');
      setNotice('Tax code marked staff-verified against its recorded reference. This is not an automatic government validation.');
      await refresh();
    } catch(e) {setError(e instanceof Error?e.message:'Tax code could not be verified.');}
    finally {setSaving(false);}
  }

  const registrationType=profileForm.registrationType;
  return <section className="finance-panel finance-tax-readiness">
    <div className="finance-section-heading finance-section-heading-wrap"><div><h2>GST &amp; e-invoice readiness</h2>
      <p>Configure real dealership details and a source-backed tax-code catalogue before a separate statutory invoice workflow is enabled.</p></div>
      <button type="button" className="finance-small-button finance-small-button-muted" disabled={loading} onClick={()=>void refresh()}>Refresh setup</button>
    </div>
    {error&&<div className="finance-alert finance-alert-error" role="alert">{error}</div>}
    {notice&&<div className="finance-alert finance-alert-success" role="status">{notice}</div>}
    {loading?<div className="finance-empty">Loading tax configuration…</div>:<>
      <div className="finance-tax-readiness-status">
        <div><span>Configuration status</span><strong>{(readiness?.status??'UNKNOWN').replaceAll('_',' ')}</strong></div>
        <div><span>Staff-verified tax codes</span><strong>{readiness?.verifiedTaxCodeCount??0}</strong></div>
        <div><span>Draft tax codes</span><strong>{readiness?.draftTaxCodeCount??0}</strong></div>
        <div><span>IRP integration</span><strong>Not connected</strong></div>
      </div>
      {canManage&&<form className="finance-tax-profile-form" onSubmit={(event)=>void saveProfile(event)}>
        <div className="finance-section-heading"><div><h3>Dealership tax profile</h3><p>Use values from the dealership’s actual GST registration and a reviewed applicability assessment. GSTIN format is checked locally only.</p></div></div>
        <label>Registration type<select required value={profileForm.registrationType} onChange={e=>setProfileForm(v=>({...v,registrationType:e.target.value as RegistrationType}))}>
          <option value="">Select registration type</option><option value="REGULAR">Regular GST registration</option><option value="COMPOSITION">Composition scheme</option><option value="SEZ">SEZ</option><option value="UNREGISTERED">Unregistered</option>
        </select></label>
        {registrationType!=='UNREGISTERED'&&<><label>GSTIN<input maxLength={15} value={profileForm.gstin} onChange={e=>setProfileForm(v=>({...v,gstin:e.target.value.toUpperCase()}))} placeholder="Enter the registered GSTIN"/></label>
          <label>Registered legal name<input maxLength={160} value={profileForm.legalName} onChange={e=>setProfileForm(v=>({...v,legalName:e.target.value}))}/></label>
          <label>Trade name (optional)<input maxLength={160} value={profileForm.tradeName} onChange={e=>setProfileForm(v=>({...v,tradeName:e.target.value}))}/></label>
          <label>Registered business address<textarea rows={2} maxLength={1000} value={profileForm.registeredAddress} onChange={e=>setProfileForm(v=>({...v,registeredAddress:e.target.value}))}/></label>
          <label>GST state code<input maxLength={2} inputMode="numeric" pattern="[0-9]{2}" value={profileForm.stateCode} onChange={e=>setProfileForm(v=>({...v,stateCode:e.target.value}))} placeholder="Two digits matching GSTIN"/></label>
          {registrationType!=='COMPOSITION'&&<><label>E-invoice applicability<select value={profileForm.eInvoiceApplicability} onChange={e=>setProfileForm(v=>({...v,eInvoiceApplicability:e.target.value as Applicability}))}>
            <option value="NOT_ASSESSED">Not assessed yet</option><option value="APPLICABLE">Applicable (assessment recorded)</option><option value="NOT_APPLICABLE">Not applicable (assessment recorded)</option>
          </select></label>
          {profileForm.eInvoiceApplicability!=='NOT_ASSESSED'&&<><label>Financial year assessed<input required maxLength={9} pattern="20[0-9]{2}-[0-9]{2}" placeholder="2026-27" value={profileForm.assessedFinancialYear} onChange={e=>setProfileForm(v=>({...v,assessedFinancialYear:e.target.value}))}/></label>
            <label>Basis of assessment<textarea required maxLength={500} rows={2} value={profileForm.applicabilityAssessmentNote} onChange={e=>setProfileForm(v=>({...v,applicabilityAssessmentNote:e.target.value}))} placeholder="Record the turnover/exemption review and supporting basis"/></label></>}
          </>}
        </>}
        <div className="finance-tax-form-footer"><span>Changes are audit-logged. This profile alone cannot issue a tax invoice, create an IRN, or prove e-invoice exemption.</span>
          <button type="submit" className="finance-primary-button" disabled={saving||!profileForm.registrationType}>{saving?'Saving…':'Save tax profile'}</button></div>
      </form>}
      {!canManage&&<div className="finance-empty">Your role can review the tax configuration but cannot change it. Settings permission is required.</div>}
      <div className="finance-tax-code-section">
        <div className="finance-section-heading"><div><h3>HSN/SAC and tax-code catalogue</h3><p>Rates are manually entered from a referenced source; no default tax rate is assumed.</p></div></div>
        {canManage&&<form className="finance-tax-code-form" onSubmit={(event)=>void createCode(event)}>
          <label>Internal code<input required maxLength={48} value={codeForm.code} onChange={e=>setCodeForm(v=>({...v,code:e.target.value.toUpperCase()}))} placeholder="e.g. BIKE-GST-01"/></label>
          <label>Description<input required maxLength={250} value={codeForm.description} onChange={e=>setCodeForm(v=>({...v,description:e.target.value}))}/></label>
          <label>HSN/SAC<input required minLength={4} maxLength={8} pattern="[0-9]{4,8}" inputMode="numeric" value={codeForm.hsnSacCode} onChange={e=>setCodeForm(v=>({...v,hsnSacCode:e.target.value}))}/></label>
          <label>Supply type<select value={codeForm.supplyType} onChange={e=>setCodeForm(v=>({...v,supplyType:e.target.value}))}><option value="GOODS">Goods</option><option value="SERVICES">Services</option></select></label>
          <label>GST rate (%)<input required type="number" min="0" max="100" step="0.01" value={codeForm.gstRate} onChange={e=>setCodeForm(v=>({...v,gstRate:e.target.value}))}/></label>
          <label>Cess rate (%)<input type="number" min="0" max="100" step="0.01" value={codeForm.cessRate} onChange={e=>setCodeForm(v=>({...v,cessRate:e.target.value}))}/></label>
          <label>Effective from<input type="date" required value={codeForm.effectiveFrom} onChange={e=>setCodeForm(v=>({...v,effectiveFrom:e.target.value}))}/></label>
          <label>Effective to (optional)<input type="date" min={codeForm.effectiveFrom} value={codeForm.effectiveTo} onChange={e=>setCodeForm(v=>({...v,effectiveTo:e.target.value}))}/></label>
          <label className="finance-tax-source-field">Source reference<input maxLength={500} value={codeForm.sourceReference} onChange={e=>setCodeForm(v=>({...v,sourceReference:e.target.value}))} placeholder="Official notification / CA-reviewed reference"/></label>
          <div className="finance-tax-form-footer"><span>New codes remain Draft until an authorised staff member confirms the source and review basis.</span><button className="finance-primary-button" type="submit" disabled={saving||!codeForm.gstRate}>Save draft tax code</button></div>
        </form>}
        {codes.length===0?<div className="finance-empty">No tax codes configured. No sample HSN/SAC values or GST rates have been inserted.</div>:
          <div className="finance-table-scroll"><table className="finance-table"><thead><tr><th>Code / HSN-SAC</th><th>Classification</th><th>Rate</th><th>Effective</th><th>Status / source</th><th>Review action</th></tr></thead>
            <tbody>{codes.map(code=><tr key={code.publicId}><td><strong>{code.code}</strong><small>{code.hsnSacCode}</small></td>
              <td><strong>{code.description}</strong><small>{code.supplyType}</small></td>
              <td>{moneyRate(code.gstRate)} GST<small>{moneyRate(code.cessRate)} cess</small></td>
              <td>{dateLabel(code.effectiveFrom)}<small>to {dateLabel(code.effectiveTo)}</small></td>
              <td><span className={'finance-status '+(code.status==='VERIFIED'?'finance-status-approved':'finance-status-pending-approval')}>{code.status==='VERIFIED'?'Staff verified':'Draft'}</span>
                <small>{code.sourceReference||'No source reference recorded'}</small>{code.verifiedByName&&<small>Reviewed by {code.verifiedByName} · {dateLabel(code.verifiedAt)}</small>}{code.verificationNote&&<small>{code.verificationNote}</small>}</td>
              <td>{code.status==='DRAFT'&&canManage?<div className="finance-row-actions">
                {verifyId!==code.publicId?<button type="button" className="finance-small-button" disabled={saving} onClick={()=>{setVerifyId(code.publicId);setVerificationNote('');}}>Confirm source review</button>:
                  <form className="finance-review-form" onSubmit={e=>{e.preventDefault();void verifyCode(code);}}>
                    <label>Review basis<textarea rows={2} required minLength={3} maxLength={500} value={verificationNote} onChange={e=>setVerificationNote(e.target.value)} placeholder="Where was the classification/rate checked?"/></label>
                    <div><button type="submit" className="finance-small-button" disabled={saving||!code.sourceReference?.trim()||verificationNote.trim().length<3}>Confirm review</button>
                      <button type="button" className="finance-small-button finance-small-button-muted" onClick={()=>setVerifyId(null)}>Cancel</button></div>
                  </form>}
              </div>:<small>{code.status==='VERIFIED'?'Verified codes are preserved; create a new effective-dated entry to change a rate.':'Settings permission required.'}</small>}</td>
            </tr>)}</tbody></table></div>}
      </div>
      <div className="finance-tax-warning"><strong>Not a statutory invoicing workflow</strong>
        <p>GST profile fields are self-entered and not verified against GSTN. “Staff verified” means a staff member recorded a source and review note. The current invoice and receipt screens do not use this catalogue, no GST is calculated, and no IRP API is connected. Do not present documents from this system as GST tax invoices or claim an IRN until the separate compliant workflow and production credentials have been implemented and tested.</p>
      </div>
    </>}
  </section>;
}
