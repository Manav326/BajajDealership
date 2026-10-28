export type PrintField = { label: string; value: string };
export type PrintLine = { description: string; detail?: string; amount?: string };
type PrintDocument = { title: string; documentNumber: string; subtitle?: string; fields: PrintField[]; lines?: PrintLine[]; note: string };
function escapeHtml(value: string): string {
  return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
/** Opens an isolated operational document; the browser print dialog can save it as PDF. */
export function printFinanceDocument(document: PrintDocument): void {
  const popup=window.open('','_blank','width=900,height=720');
  if(!popup){window.alert('Allow pop-ups for this site to print or save this document as a PDF.');return;}
  popup.opener=null;
  const fields=document.fields.map(f=>'<div class="field"><span>'+escapeHtml(f.label)+'</span><strong>'+escapeHtml(f.value)+'</strong></div>').join('');
  const lines=(document.lines??[]).map(line=>'<tr><td><strong>'+escapeHtml(line.description)+'</strong>'+(line.detail?'<small>'+escapeHtml(line.detail)+'</small>':'')+'</td><td class="amount">'+escapeHtml(line.amount??'—')+'</td></tr>').join('');
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(document.title+' '+document.documentNumber)+'</title><style>'+
    '@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:12px/1.5 Arial,sans-serif;color:#111827;margin:0}header{display:flex;justify-content:space-between;gap:18px;border-bottom:2px solid #17243b;padding-bottom:14px;margin-bottom:16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 5px}p{margin:4px 0;color:#4b5563}.document-no{text-align:right}.document-no strong{font-size:14px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:18px 0}.field{border:1px solid #d1d5db;border-radius:5px;padding:9px}.field span,.field strong{display:block}.field span{color:#6b7280;font-size:10px;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #d1d5db;padding:9px;text-align:left;vertical-align:top}th{background:#f3f4f6;font-size:10px;text-transform:uppercase}td small{display:block;color:#6b7280;margin-top:4px}.amount{text-align:right;white-space:nowrap;font-weight:700}.note{border-top:1px solid #9ca3af;margin-top:24px;padding-top:10px;font-size:10px;color:#4b5563}</style></head><body>'+
    '<header><div><h1>Lucky Bajaj Agency</h1><h2>'+escapeHtml(document.title)+'</h2><p>'+escapeHtml(document.subtitle??'Dealership operational record')+'</p></div><div class="document-no"><p>Document number</p><strong>'+escapeHtml(document.documentNumber)+'</strong></div></header>'+
    '<div class="fields">'+fields+'</div>'+(lines?'<table><thead><tr><th>Description</th><th class="amount">Amount</th></tr></thead><tbody>'+lines+'</tbody></table>':'')+
    '<div class="note">'+escapeHtml(document.note)+'</div></body></html>';
  popup.addEventListener('load',()=>{popup.focus();popup.print();},{once:true});
  popup.document.open();popup.document.write(html);popup.document.close();
}
