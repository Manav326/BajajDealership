import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../apiClient';

type Channel = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CARD' | 'OTHER';
type Values = Record<Channel, string>;
type Line = { paymentMethod: Channel; openingBalance: number|string; recordedCollections: number|string;
  paymentReversals: number|string; refundPayouts: number|string; approvedExpenses: number|string; expenseReversals: number|string;
  expectedClosing: number|string; countedClosing: number|string; variance: number|string };
type Close = { publicId: string|null; businessDate: string; closed: boolean; closedAt: string|null;
  closedByName: string|null; notes: string|null; channels: Line[]; expectedTotal: number|string;
  countedTotal: number|string; varianceTotal: number|string };
type Props = { token: string; permissions: string[] };
const CHANNELS: {key:Channel;label:string}[] = [
  {key:'CASH',label:'Cash'},{key:'UPI',label:'UPI'},{key:'BANK_TRANSFER',label:'Bank transfer'},
  {key:'CARD',label:'Card'},{key:'OTHER',label:'Other'}
];
const today = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const zeros = (): Values => ({CASH:'0.00',UPI:'0.00',BANK_TRANSFER:'0.00',CARD:'0.00',OTHER:'0.00'});
const n = (v:number|string|undefined) => Number.isFinite(Number(v??0)) ? Number(v??0) : 0;
const money = (v:number|string|undefined) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(n(v));
const dateTime = (v:string|null) => v ? new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)) : '—';
const valuesFrom = (rows:Line[],key:'openingBalance'|'countedClosing'):Values => {
  const values=zeros(); rows.forEach(r=>{values[r.paymentMethod]=n(r[key]).toFixed(2);}); return values;
};

export default function DailyCloseWorkspace({token,permissions}:Props) {
  const [businessDate,setBusinessDate]=useState(today);
  const [close,setClose]=useState<Close|null>(null);
  const [opening,setOpening]=useState<Values>(zeros);
  const [counted,setCounted]=useState<Values>(zeros);
  const [notes,setNotes]=useState('');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const canView=permissions.includes('finance.close.read');
  const canClose=permissions.includes('finance.reconcile');
  const refresh=useCallback(async()=>{
    if(!canView){setLoading(false);return;}
    setLoading(true);setError('');setNotice('');
    try {
      const result=await apiFetch<Close>('/api/v1/admin/finance/daily-close/preview?businessDate='+encodeURIComponent(businessDate),token);
      setClose(result);setNotes(result.notes??'');
      setOpening(valuesFrom(result.channels,'openingBalance'));setCounted(valuesFrom(result.channels,'countedClosing'));
    } catch(e) {setClose(null);setError(e instanceof Error?e.message:'Daily close could not be loaded.');}
    finally {setLoading(false);}
  },[businessDate,canView,token]);
  useEffect(()=>{void refresh();},[refresh]);

  async function submitClose() {
    if(!close||close.closed)return;
    setSaving(true);setError('');setNotice('');
    try {
      const result=await apiFetch<Close>('/api/v1/admin/finance/daily-close',token,{method:'POST',body:JSON.stringify({
        businessDate,
        openingBalances:{cash:Number(opening.CASH),upi:Number(opening.UPI),bankTransfer:Number(opening.BANK_TRANSFER),card:Number(opening.CARD),other:Number(opening.OTHER)},
        countedClosing:{cash:Number(counted.CASH),upi:Number(counted.UPI),bankTransfer:Number(counted.BANK_TRANSFER),card:Number(counted.CARD),other:Number(counted.OTHER)},
        notes:notes.trim()||null
      })});
      setClose(result);setOpening(valuesFrom(result.channels,'openingBalance'));setCounted(valuesFrom(result.channels,'countedClosing'));
      setNotice('Daily close saved. The snapshot is locked and cannot be overwritten.');
    } catch(e) {setError(e instanceof Error?e.message:'Daily close could not be saved.');}
    finally {setSaving(false);}
  }

  const channels=close?.channels??[];
  const expectedTotal=channels.reduce((total,row)=>total+n(opening[row.paymentMethod])+n(row.recordedCollections)
    -n(row.paymentReversals)-n(row.refundPayouts)-n(row.approvedExpenses)+n(row.expenseReversals),0);
  const variance=channels.reduce((total,row)=>{
    const expected=n(opening[row.paymentMethod])+n(row.recordedCollections)-n(row.paymentReversals)-n(row.refundPayouts)-n(row.approvedExpenses)+n(row.expenseReversals);
    return total+n(counted[row.paymentMethod])-expected;
  },0);

  return <section className="finance-panel finance-daily-close">
    <div className="finance-section-heading finance-section-heading-wrap">
      <div><h2>Daily closing &amp; reconciliation</h2><p>Compare ledger movements with counted cash or statement balances. Each business date can be closed once.</p></div>
      <label className="finance-filter">Business date<input type="date" max={today()} value={businessDate} onChange={e=>setBusinessDate(e.target.value)}/></label>
    </div>
    {!canView&&<div className="finance-empty">Your role cannot view daily close records.</div>}
    {error&&<div className="finance-alert finance-alert-error" role="alert">{error}</div>}
    {notice&&<div className="finance-alert finance-alert-success" role="status">{notice}</div>}
    {canView&&loading&&<div className="finance-empty">Loading saved ledger movements…</div>}
    {canView&&!loading&&close&&<>
      <div className="finance-close-summary">
        <div><span>Status</span><strong>{close.closed?'Closed · immutable snapshot':'Preview · not closed'}</strong></div>
        <div><span>Expected closing total</span><strong>{money(close.closed?close.expectedTotal:expectedTotal)}</strong></div>
        <div><span>Net variance</span><strong className={(close.closed?n(close.varianceTotal):variance)===0?'finance-variance-zero':'finance-variance-nonzero'}>{money(close.closed?close.varianceTotal:variance)}</strong></div>
      </div>
      <div className="finance-table-scroll"><table className="finance-table finance-close-table">
        <thead><tr><th>Channel</th><th>Opening</th><th>Collections</th><th>Payment reversals</th><th>Refund payouts</th><th>Expenses</th><th>Expense reversals</th><th>Expected</th><th>Counted / statement</th><th>Variance</th></tr></thead>
        <tbody>{channels.map(row=>{
          const expected=n(opening[row.paymentMethod])+n(row.recordedCollections)-n(row.paymentReversals)-n(row.refundPayouts)-n(row.approvedExpenses)+n(row.expenseReversals);
          const delta=n(counted[row.paymentMethod])-expected;
          return <tr key={row.paymentMethod}><td><strong>{CHANNELS.find(c=>c.key===row.paymentMethod)?.label}</strong></td>
            <td>{close.closed?money(row.openingBalance):<input aria-label={row.paymentMethod+' opening balance'} className="finance-balance-input" type="number" min="0" step="0.01" value={opening[row.paymentMethod]} onChange={e=>setOpening(v=>({...v,[row.paymentMethod]:e.target.value}))}/>}</td>
            <td>{money(row.recordedCollections)}</td><td>{money(row.paymentReversals)}</td><td>{money(row.refundPayouts)}</td><td>{money(row.approvedExpenses)}</td><td>{money(row.expenseReversals)}</td>
            <td><strong>{money(close.closed?row.expectedClosing:expected)}</strong></td>
            <td>{close.closed?money(row.countedClosing):<input aria-label={row.paymentMethod+' counted closing balance'} className="finance-balance-input" type="number" min="0" step="0.01" value={counted[row.paymentMethod]} onChange={e=>setCounted(v=>({...v,[row.paymentMethod]:e.target.value}))}/>}</td>
            <td><strong className={(close.closed?n(row.variance):delta)===0?'finance-variance-zero':'finance-variance-nonzero'}>{money(close.closed?row.variance:delta)}</strong></td>
          </tr>;
        })}</tbody>
      </table></div>
      <label className="finance-close-notes">Closing notes / variance explanation<textarea rows={2} maxLength={1000} value={notes} disabled={close.closed} onChange={e=>setNotes(e.target.value)} placeholder="Explain differences before finalising."/></label>
      <div className="finance-close-actions">
        <span>{close.closed?'Closed by '+(close.closedByName??'authorised staff')+' on '+dateTime(close.closedAt)+'. Saved values cannot be edited.':'The close uses saved ledger entries; bank, UPI and card settlement is not independently verified.'}</span>
        {close.closed?<button type="button" className="finance-primary-button" onClick={()=>window.print()}>Print / Save PDF</button>:
          <button type="button" className="finance-primary-button" disabled={!canClose||saving||CHANNELS.some(c=>!Number.isFinite(Number(opening[c.key]))||Number(opening[c.key])<0||!Number.isFinite(Number(counted[c.key]))||Number(counted[c.key])<0)} onClick={()=>void submitClose()}>{saving?'Saving close…':canClose?'Close business day':'Closing permission required'}</button>}
      </div>
      <div className="finance-print-target"><h1>Lucky Bajaj Agency</h1><h2>Daily finance close</h2>
        <p><strong>Business date:</strong> {close.businessDate}</p><p><strong>Status:</strong> {close.closed?'Closed snapshot':'Preview only — not closed'}</p>
        {close.closed&&<p><strong>Closed by:</strong> {close.closedByName} · {dateTime(close.closedAt)}</p>}
        <table><thead><tr><th>Channel</th><th>Opening</th><th>Collections</th><th>Reversals</th><th>Refund payouts</th><th>Expenses</th><th>Expense reversals</th><th>Expected</th><th>Counted</th><th>Variance</th></tr></thead>
          <tbody>{channels.map(r=><tr key={r.paymentMethod}><td>{r.paymentMethod}</td><td>{money(r.openingBalance)}</td><td>{money(r.recordedCollections)}</td><td>{money(r.paymentReversals)}</td><td>{money(r.refundPayouts)}</td><td>{money(r.approvedExpenses)}</td><td>{money(r.expenseReversals)}</td><td>{money(r.expectedClosing)}</td><td>{money(r.countedClosing)}</td><td>{money(r.variance)}</td></tr>)}</tbody>
        </table><p><strong>Notes:</strong> {close.notes||'—'}</p>
        <p className="finance-print-disclaimer">Operational reconciliation from saved records only; no bank/UPI/card settlement or GST calculation is represented.</p>
      </div>
    </>}
  </section>;
}
