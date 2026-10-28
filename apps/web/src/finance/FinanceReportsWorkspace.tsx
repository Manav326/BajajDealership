import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../apiClient';
type Row={businessDate:string;salesInvoiced:number|string;salesCancelled:number|string;salesInvoiceCount:number;
 workshopInvoiced:number|string;workshopCancelled:number|string;workshopInvoiceCount:number;salesCollections:number|string;
 salesReceiptCount:number;workshopCollections:number|string;workshopReceiptCount:number;salesPaymentReversals:number|string;
 workshopPaymentReversals:number|string;approvedExpenses:number|string;expenseReversals:number|string};
type Props={token:string;permissions:string[]};
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const firstDay=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),'01'].join('-');};
const n=(v:number|string|undefined)=>Number.isFinite(Number(v??0))?Number(v??0):0;
const money=(v:number|string|undefined)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(n(v));
const csv=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
export default function FinanceReportsWorkspace({token,permissions}:Props){
 const [fromDate,setFromDate]=useState(firstDay);const [toDate,setToDate]=useState(today);const [rows,setRows]=useState<Row[]>([]);
 const [loading,setLoading]=useState(true);const [error,setError]=useState('');const canExport=permissions.includes('report.export');
 const load=useCallback(async()=>{setLoading(true);setError('');try{
   setRows(await apiFetch<Row[]>('/api/v1/admin/finance/reports/daily?fromDate='+encodeURIComponent(fromDate)+'&toDate='+encodeURIComponent(toDate),token));
 }catch(e){setError(e instanceof Error?e.message:'Report could not be loaded.');}finally{setLoading(false);}},[fromDate,toDate,token]);
 useEffect(()=>{void load();},[load]);
 const totals=useMemo(()=>rows.reduce((s,r)=>({sales:s.sales+n(r.salesInvoiced),workshop:s.workshop+n(r.workshopInvoiced),
  salesCollections:s.salesCollections+n(r.salesCollections),workshopCollections:s.workshopCollections+n(r.workshopCollections),
  reversals:s.reversals+n(r.salesPaymentReversals)+n(r.workshopPaymentReversals),expenses:s.expenses+n(r.approvedExpenses),
  expenseReversals:s.expenseReversals+n(r.expenseReversals)}),{sales:0,workshop:0,salesCollections:0,workshopCollections:0,reversals:0,expenses:0,expenseReversals:0}),[rows]);
 function exportCsv(){if(!canExport||!rows.length)return;const header=['Date','Sales invoiced','Sales cancelled','Workshop invoiced','Workshop cancelled','Sales collections','Sales receipts','Workshop collections','Workshop receipts','Sales reversals','Workshop reversals','Approved expenses','Expense reversals'];const lines=rows.map(r=>[r.businessDate,r.salesInvoiced,r.salesCancelled,r.workshopInvoiced,r.workshopCancelled,r.salesCollections,r.salesReceiptCount,r.workshopCollections,r.workshopReceiptCount,r.salesPaymentReversals,r.workshopPaymentReversals,r.approvedExpenses,r.expenseReversals]);const content=[header,...lines].map(row=>row.map(csv).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='lucky-bajaj-finance-'+fromDate+'-'+toDate+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);}
 return <div className="finance-workspace">
  <section className="finance-header"><div><div className="finance-eyebrow">BUSINESS CONTROL · SAVED RECORDS</div><h1>Financial reports</h1><p>Date-wise invoice, collection, reversal and approved-expense events from saved records.</p></div>
   <div className="finance-report-filters"><label>From<input type="date" value={fromDate} max={toDate} onChange={e=>setFromDate(e.target.value)}/></label><label>To<input type="date" value={toDate} min={fromDate} max={today()} onChange={e=>setToDate(e.target.value)}/></label><button className="finance-primary-button" type="button" disabled={loading} onClick={()=>void load()}>Refresh report</button></div>
  </section>
  {error&&<div className="finance-alert finance-alert-error" role="alert">{error}</div>}
  <section className="finance-summary-grid">
   <article className="finance-glass-card"><span className="finance-card-label">Sales invoiced</span><strong>{money(totals.sales)}</strong><small>Cancelled invoices are separate events</small></article>
   <article className="finance-glass-card"><span className="finance-card-label">Workshop invoiced</span><strong>{money(totals.workshop)}</strong><small>Issued invoice event totals</small></article>
   <article className="finance-glass-card"><span className="finance-card-label">Recorded collections</span><strong>{money(totals.salesCollections+totals.workshopCollections)}</strong><small>Manual receipt records</small></article>
   <article className="finance-glass-card finance-glass-card-warm"><span className="finance-card-label">Payment reversals</span><strong>{money(totals.reversals)}</strong><small>Not proof of a gateway refund</small></article>
   <article className="finance-glass-card"><span className="finance-card-label">Approved expenses</span><strong>{money(totals.expenses)}</strong><small>Grouped by expense date</small></article>
   <article className="finance-glass-card finance-glass-card-pending"><span className="finance-card-label">Expense reversals</span><strong>{money(totals.expenseReversals)}</strong><small>Reversal events in period</small></article>
  </section>
  <section className="finance-panel"><div className="finance-section-heading finance-section-heading-wrap"><div><h2>Daily activity</h2><p>Issue and cancellation events are reported separately; values are operational, not statutory tax figures.</p></div><div className="finance-report-actions"><button className="finance-small-button finance-small-button-muted" type="button" onClick={()=>window.print()}>Print / Save PDF</button>{canExport&&<button className="finance-small-button" type="button" disabled={!rows.length} onClick={exportCsv}>Export CSV</button>}</div></div>
   {loading?<div className="finance-empty">Loading dated records…</div>:!rows.length?<div className="finance-empty">No saved events fall in this date range.</div>:
    <div className="finance-table-scroll"><table className="finance-table finance-report-table"><thead><tr><th>Date</th><th>Sales invoiced</th><th>Sales cancelled</th><th>Workshop invoiced</th><th>Workshop cancelled</th><th>Sales collections</th><th>Workshop collections</th><th>Payment reversals</th><th>Expenses</th><th>Expense reversals</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.businessDate}><td><strong>{r.businessDate}</strong></td><td>{money(r.salesInvoiced)}<small>{r.salesInvoiceCount} issue events</small></td><td>{money(r.salesCancelled)}</td><td>{money(r.workshopInvoiced)}<small>{r.workshopInvoiceCount} issue events</small></td><td>{money(r.workshopCancelled)}</td><td>{money(r.salesCollections)}<small>{r.salesReceiptCount} receipt(s)</small></td><td>{money(r.workshopCollections)}<small>{r.workshopReceiptCount} receipt(s)</small></td><td>{money(n(r.salesPaymentReversals)+n(r.workshopPaymentReversals))}</td><td>{money(r.approvedExpenses)}</td><td>{money(r.expenseReversals)}</td></tr>)}</tbody></table></div>}
  </section>
  <section className="finance-source-note"><strong>Data and accounting note</strong><p>The report groups saved events by the dealership-configured time zone. These are operational invoices and manually recorded payments, not GST tax returns or independently verified bank/UPI/card settlement.</p></section>
  <div className="finance-print-target"><h1>Lucky Bajaj Agency</h1><h2>Financial report</h2><p><strong>Period:</strong> {fromDate} to {toDate}</p><table><thead><tr><th>Date</th><th>Sales invoiced</th><th>Sales cancelled</th><th>Workshop invoiced</th><th>Workshop cancelled</th><th>Sales collections</th><th>Workshop collections</th><th>Payment reversals</th><th>Expenses</th><th>Expense reversals</th></tr></thead><tbody>{rows.map(r=><tr key={r.businessDate}><td>{r.businessDate}</td><td>{money(r.salesInvoiced)}</td><td>{money(r.salesCancelled)}</td><td>{money(r.workshopInvoiced)}</td><td>{money(r.workshopCancelled)}</td><td>{money(r.salesCollections)}</td><td>{money(r.workshopCollections)}</td><td>{money(n(r.salesPaymentReversals)+n(r.workshopPaymentReversals))}</td><td>{money(r.approvedExpenses)}</td><td>{money(r.expenseReversals)}</td></tr>)}</tbody></table><p className="finance-print-disclaimer">Operational records only, not a GST return or proof of external settlement.</p></div>
 </div>;
}
