import { useEffect, useState } from 'react';
import { apiFetch } from '../apiClient';

type Report = {
  fromDate:string;toDate:string;dealershipTimeZone:string;
  enquiriesCreated:number;bookingsCreated:number;vehicleDeliveries:number;completedTestRides:number;
  workshopJobsCheckedIn:number;currentJobStatusesForPeriod:{currentStatus:string;jobCount:number}[];
  workshopInvoicesIssued:number;workshopInvoiceValue:number|string;
  sparePartPurchaseReceipts:number;sparePartPurchaseValue:number|string;
  sparePartUnitsIssued:number|string;sparePartUnitsReturned:number|string;
  sparePartMovements:{movementType:string;movementCount:number;quantity:number|string}[];
  currentOutOfStockPartCount:number;currentLowStockPartCount:number;
};
type Props={token:string;fromDate:string;toDate:string};
const money=(v:number|string)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(v)||0);
const label=(v:string)=>v.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
export default function OperationalReportsWorkspace({token,fromDate,toDate}:Props){
  const [report,setReport]=useState<Report|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');
    void apiFetch<Report>('/api/v1/admin/finance/reports/operations?fromDate='+encodeURIComponent(fromDate)+'&toDate='+encodeURIComponent(toDate),token)
      .then(value=>{if(active)setReport(value);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Operations report could not be loaded.');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[token,fromDate,toDate]);
  return <section className="finance-panel">
    <div className="finance-section-heading"><div><h2>Operational performance &amp; inventory</h2>
      <p>Event activity uses {report?.dealershipTimeZone || 'the dealership time zone'} from {fromDate} through {toDate}.
      Job-card status is the current status of job cards checked in during this period; stock alerts are current snapshots.</p>
    </div></div>
    {error&&<div className="finance-alert finance-alert-error" role="alert">{error}</div>}
    {loading?<div className="finance-empty">Loading operations metrics…</div>:report&&<>
      <div className="finance-summary-grid">
        <article className="finance-glass-card"><span className="finance-card-label">Enquiries created</span><strong>{report.enquiriesCreated}</strong><small>Created in selected period</small></article>
        <article className="finance-glass-card"><span className="finance-card-label">Bookings created</span><strong>{report.bookingsCreated}</strong><small>Created in selected period</small></article>
        <article className="finance-glass-card"><span className="finance-card-label">Vehicle deliveries</span><strong>{report.vehicleDeliveries}</strong><small>Handover timestamp in period</small></article>
        <article className="finance-glass-card"><span className="finance-card-label">Completed test rides</span><strong>{report.completedTestRides}</strong><small>Completion timestamp in period</small></article>
        <article className="finance-glass-card"><span className="finance-card-label">Workshop jobs checked in</span><strong>{report.workshopJobsCheckedIn}</strong><small>Check-in timestamp in period</small></article>
        <article className="finance-glass-card"><span className="finance-card-label">Workshop invoices issued</span><strong>{report.workshopInvoicesIssued}</strong><small>{money(report.workshopInvoiceValue)} operational invoice value</small></article>
        <article className="finance-glass-card"><span className="finance-card-label">Parts received</span><strong>{report.sparePartPurchaseReceipts}</strong><small>{money(report.sparePartPurchaseValue)} saved purchase receipt value</small></article>
        <article className="finance-glass-card"><span className="finance-card-label">Parts issued / returned</span><strong>{Number(report.sparePartUnitsIssued).toLocaleString('en-IN')} / {Number(report.sparePartUnitsReturned).toLocaleString('en-IN')}</strong><small>Stock movement quantities</small></article>
        <article className="finance-glass-card finance-glass-card-warm"><span className="finance-card-label">Out of stock now</span><strong>{report.currentOutOfStockPartCount}</strong><small>Active SKUs with zero / missing balance</small></article>
        <article className="finance-glass-card finance-glass-card-pending"><span className="finance-card-label">Low stock now</span><strong>{report.currentLowStockPartCount}</strong><small>Positive balance at / below reorder threshold</small></article>
      </div>
      <div className="finance-source-split">
        <div className="finance-table-scroll"><table className="finance-table">
          <thead><tr><th>Job-card status now</th><th>Cards checked in during period</th></tr></thead>
          <tbody>{report.currentJobStatusesForPeriod.length?report.currentJobStatusesForPeriod.map(row=>
            <tr key={row.currentStatus}><td>{label(row.currentStatus)}</td><td>{row.jobCount}</td></tr>)
            :<tr><td colSpan={2}>No job cards were checked in during this period.</td></tr>}</tbody>
        </table></div>
        <div className="finance-table-scroll"><table className="finance-table">
          <thead><tr><th>Spare-part movement</th><th>Movement entries</th><th>Quantity moved</th></tr></thead>
          <tbody>{report.sparePartMovements.length?report.sparePartMovements.map(row=>
            <tr key={row.movementType}><td>{label(row.movementType)}</td><td>{row.movementCount}</td><td>{Number(row.quantity).toLocaleString('en-IN')}</td></tr>)
            :<tr><td colSpan={3}>No spare-part movements occurred during this period.</td></tr>}</tbody>
        </table></div>
      </div>
      <p className="finance-source-note">These are dealership-scoped operational counts from saved source events, not a conversion-rate forecast or statutory financial report.</p>
    </>}
  </section>;
}
