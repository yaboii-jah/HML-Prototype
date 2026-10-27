import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { seedDemo } from './fixtures/workspace.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { initializePoDocument } from '../src/domain/po-document.ts';
import { poFinancialBreakdown } from '../src/domain/pricing.ts';
import { poTotal, budgetFor, paymentStatus } from '../src/domain/selectors.ts';
import { migrateV10 } from '../src/mock/repository.ts';
import { captureBidReport } from '../src/domain/bid-reports.ts';
import { comparisonPages } from '../src/domain/comparison-layout.ts';
import { generatePoPdf } from '../src/server/template-po-pdf.ts';
import { generateMrfPdf } from '../src/server/template-mrf-pdf.ts';
import { generateBidPdf } from '../src/server/bid-pdf.ts';
import { buildBidWorkbook } from '../src/server/bid-workbook.ts';
import { validBidChunk, sealBidUploadTicket, openBidUploadTicket } from '../src/server/bid-upload-ticket.ts';

const context = { now: () => '2026-09-30T10:00:00.000Z', id: prefix => `${prefix}-template-test` };
function fixture() {
  const state = seedDemo(), request = state.requests[0], quote = state.quotes.find(value => value.id === state.pos[0].quoteId), po = state.pos[0], site = state.sites[0];
  site.driveFolderId = 'sample-project-folder';
  initializePoDocument(po, request, quote, site, context.now());
  po.document.vendorName = 'Supplier'; po.financial.reviewed = true;
  return { state, request, quote, po, site };
}
test('VAT replaces inherited taxes once, EWT reduces all payable and budget figures consistently', () => {
  const { state, po } = fixture(); state.pos = [po]; state.payments = [];
  po.lines = [{ itemId: 'm1-i1', quoteLineId: '', quantity: 10, unitPrice: 100, taxRate: 12, discountType: 'percentage', discountValue: 10 }];
  po.adjustments = [{ id:'source-vat',label:'Source VAT',kind:'tax',calculation:'percentage',value:12,included:true,confirmed:true }, { id:'freight',label:'Freight',kind:'shipping',calculation:'fixed',value:100,included:true,confirmed:true,taxable:false }];
  po.financial = { vatStatus:'VAT',priceBasis:'exclusive',vatRate:12,ewtGoods:20,ewtServices:10,reviewed:true };
  const financial = poFinancialBreakdown(po);
  assert.equal(financial.gross, 1108); assert.equal(financial.net, 1078); assert.equal(poTotal(state,po),1078);
  assert.equal(budgetFor(state, 'site-a').committed,1078);
  state.payments.push({id:'net-payment',poId:po.id,amount:1078,method:'Bank',reference:'payment',date:'2026-09-30',actor:'Accounting'});
  assert.equal(paymentStatus(state,po),'Paid');
  state.sites[0].driveFolderId='financial-test-folder';const financialData=captureBidReport(state,po.mrfId);const financialBook=buildBidWorkbook({id:'financial-report',requestId:po.mrfId,version:1,generatedAt:context.now(),fileName:'financial.xlsx',archive:{status:'pending'},data:financialData});const awardSheet=financialBook.getWorksheet('Awards');const netRow=awardSheet.getRows(1,awardSheet.rowCount).find(row=>row.getCell(6).value==='Net supplier payable');assert.equal(netRow.getCell(17).result,1078);assert.match(netRow.getCell(17).formula,/ROUND/);assert.equal(awardSheet.getCell('Q9').result,1008); assert.equal(budgetFor(state,'site-a').committed,0); assert.equal(budgetFor(state,'site-a').spent,1078);
  po.financial.priceBasis='inclusive'; assert.equal(poTotal(state,po),970);
  po.financial.vatStatus='NON-VAT';po.financial.priceBasis='exclusive';assert.equal(poTotal(state,po),970);
});
test('Accounting approval requires reviewed finances and essential fields; failed commands preserve data', () => {
  const { state, po } = fixture(); state.role='Procurement'; po.status='draft'; po.financial.reviewed=false;
  const submitted = applyCommand(state,{type:'savePO',id:po.id,quoteId:po.quoteId,notes:'',finalize:true},context);
  assert.equal(submitted.ok,true,submitted.message); assert.equal(submitted.snapshot.pos[0].status,'submitted');
  const review = submitted.snapshot; review.role='Accounting'; const purchase = review.pos[0]; purchase.paymentMode='credit';
  const command = {type:'reviewPO',id:po.id,decision:'approve'};
  const failure=applyCommand(review,command,context); assert.equal(failure.ok,false); assert.match(failure.message,/VAT basis/);
  purchase.financial.reviewed=true;
  assert.equal(applyCommand(review,command,context).ok,true);
  purchase.financial.ewtGoods=1000000;
  assert.equal(applyCommand(review,command,context).ok,false);
  purchase.financial.ewtGoods=0; purchase.document.terms='';
  assert.equal(applyCommand(review,command,context).ok,false); assert.equal(purchase.status,'submitted');
});

test('v10 migration preserves old PO financial behavior and original bid artifacts', () => {
  const old=seedDemo();old.version=10;const migrated=migrateV10(old);
  assert.equal(migrated.version,11);assert.deepEqual(migrated.pos,old.pos);assert.equal(migrated.pos.some(po=>po.financial),false);assert.equal(poTotal(migrated,migrated.pos[0]),poTotal(old,old.pos[0]));
});
test('PDF templates retain Letter dimensions, original artwork and links; overflow keeps all pages', async () => {
  const { request, quote, po, site }=fixture();
  const mrf=await PDFDocument.load(await generateMrfPdf(request,site.name,site.location,'https://drive.google.com/file/d/support/view'));
  assert.deepEqual(mrf.getPage(0).getSize(),{width:792,height:612});assert.ok(mrf.getPage(0).node.lookup(PDFName.of('Annots')).size());
  request.items=Array.from({length:40},(_,n)=>({...request.items[0],id:`overflow-${n}`,name:`Material ${n} — a long specification and description that must not be lost`,remarks:'Delivery instructions repeated for long text coverage.'}));
  const overflow=await PDFDocument.load(await generateMrfPdf(request,site.name,site.location));assert.ok(overflow.getPageCount()>1);
  const order=await PDFDocument.load(await generatePoPdf(po,request,quote,site.name));assert.deepEqual(order.getPage(0).getSize(),{width:612,height:792});
  for(const kind of ['po','mrf','comparison'])assert.ok(fs.statSync(`src/server/document-assets/${kind}.pdf`).size>1000);
});
test('comparison retains eleven slots, latest bids, quoted amounts and supporting revisions', async () => {
  const { state, request }=fixture();const data=captureBidReport(state,request.id);
  const report={id:'report',requestId:request.id,version:1,generatedAt:context.now(),fileName:'comparison.xlsx',data,pdf:{fileName:'comparison.pdf',archive:{status:'pending'}},archive:{status:'pending'}};
  const first=data.offers[0];first.quote.lines[0].quantity=20;
  data.offers.push({...structuredClone(first),source:'PO source',quote:{...structuredClone(first.quote),id:'older',version:1}});
  const book=buildBidWorkbook(report),sheet=book.getWorksheet('Bid comparison');
  assert.equal(sheet.getCell('AA11').value,'TOTAL COST');assert.equal(sheet.getCell('E12').value,null);assert.equal(sheet.getCell('G12').result,20*first.quote.lines[0].unitPrice);assert.equal(sheet.getCell('F4').value,'SUPPLIER A');
  const older=book.getWorksheet('Quotation details');assert.ok(older.rowCount>20);
  const pdf=await PDFDocument.load(await generateBidPdf(report));assert.deepEqual(pdf.getPage(0).getSize(),{width:792,height:612});
  data.request.items[0].name='A detailed material specification with dimensions and installation requirements '.repeat(8);
  const longBook=buildBidWorkbook(report);assert.ok(longBook.worksheets.some(sheet=>sheet.name.startsWith('Continued text')));
  const longPdf=await PDFDocument.load(await generateBidPdf(report));assert.ok(longPdf.getPageCount()>1);
  data.offers=Array.from({length:12},(_,n)=>({...structuredClone(first),source:'Latest bid',quote:{...structuredClone(first.quote),id:`supplier-${n}`,supplierId:`supplier-${n}`}}));
  assert.equal(comparisonPages(report).length,2);assert.equal(comparisonPages(report)[1].supplierOffset,11);
});
test('PDF bid upload tickets reject XLSX bytes and bind the artifact type', () => {
  const key=process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY;process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY=Buffer.alloc(32,7).toString('base64');
  try {const ticket=sealBidUploadTicket({reportId:'report',format:'pdf',total:10,sessionUri:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test'});assert.equal(openBidUploadTicket(ticket).format,'pdf');assert.equal(validBidChunk(0,10,Buffer.from('%PDF-12345'),'pdf'),true);assert.equal(validBidChunk(0,10,Buffer.from('PK\u0003\u0004xxxxxx'),'pdf'),false);assert.equal(validBidChunk(0,10,Buffer.from('%PDF-12345'),'xlsx'),false);} finally {if(key===undefined)delete process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY;else process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY=key;}
});
