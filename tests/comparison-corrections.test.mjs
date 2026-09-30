import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { captureBidReport, validBidReport } from '../src/domain/bid-reports.ts';
import { resolveComparisonSelections } from '../src/domain/comparison-report.ts';
import { initializePoDocument } from '../src/domain/po-document.ts';
import { generateBidPdf } from '../src/server/bid-pdf.ts';
import { buildBidWorkbook, generateBidWorkbook } from '../src/server/bid-workbook.ts';
import { generatePoPdf } from '../src/server/template-po-pdf.ts';
import { generateMrfPdf } from '../src/server/template-mrf-pdf.ts';
import { pageText } from './helpers/pdf-text.mjs';

const context = { now: () => '2026-09-30T10:00:00Z', id: prefix => `${prefix}-corrections` };
function fixture() {
  const state = seedDemo(); state.role = 'Procurement'; state.sites[0].driveFolderId = 'comparison-folder';
  const data = captureBidReport(state, 'm1', true);
  const report = { id: 'corrected', requestId: 'm1', version: 1, generatedAt: context.now(), fileName: 'comparison.xlsx', data, comparisonRevision: 2, comparisonSelections: resolveComparisonSelections(data), archive: { status: 'pending' } };
  return { state, report };
}
const normalized = value => String(value || '').replace(/\s+/g, ' ').trim();

test('comparison uses required quantities, raw converted prices, self-contained formulas and incomplete totals', async () => {
  const { report } = fixture(), quote = report.data.offers[0].quote;
  quote.lines[0] = { ...quote.lines[0], quantity: 2, unit: 'pack', conversionFactor: 10, unitPrice: 1000, discountType: 'percentage', discountValue: 10, taxRate: 12 };
  quote.adjustments = [{ id:'shipping',label:'Freight',kind:'shipping',calculation:'fixed',value:999 }];
  quote.lines.push({ ...quote.lines[0], id:'unmatched',requestItemId:'',unitPrice:5000 });
  report.data.request.items.push({ ...report.data.request.items[0], id:'missing', name:'Unquoted material',quantity:5 });
  const bytes = await generateBidWorkbook(report), book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['Bid comparison']);
  const sheet = book.worksheets[0];
  assert.equal(sheet.columnCount, 9); assert.equal(sheet.views[0].state, 'normal'); assert.equal(sheet.pageSetup.paperSize, 1);
  const row = sheet.getRows(1,sheet.rowCount).find(row => normalized(row.getCell(2).value) === 'Portland cement');
  assert.equal(row.getCell(6).value, 100); assert.equal(row.getCell(7).result, 10000); assert.equal(row.getCell(7).formula, `ROUND(C${row.number}*F${row.number},2)`);
  const missing = sheet.getRows(1,sheet.rowCount).find(row => normalized(row.getCell(2).value) === 'Unquoted material'); assert.equal(normalized(missing.getCell(7).value), '');
  const total = sheet.getRows(1,sheet.rowCount).find(row => normalized(row.getCell(6).value) === 'INCOMPLETE TOTAL'); assert.equal(total.getCell(7).result,10000); assert.match(total.getCell(7).formula,/SUM/);
  sheet.eachRow(row => row.eachCell(cell => { assert.equal(cell.alignment.horizontal,'center'); if(cell.formula) assert.doesNotMatch(cell.formula,/Quotation details|Awards|!/); }));
  const pdf = await PDFDocument.load(await generateBidPdf(report)); assert.equal(pdf.getPageCount(),1);
  const text = pageText(pdf,pdf.getPage(0)).map(value => value.text).join(' ');
  assert.match(text,/10,000.00/); assert.match(text,/offered 20 of 100 bag/); assert.match(text,/not quoted/); assert.doesNotMatch(text,/5,000.00/);
});

test('alternative selection is explicit, validated, frozen and independent of awards', () => {
  const { state } = fixture(), quote = state.quotes[0], itemId = quote.lines[0].requestItemId;
  quote.lines.push({ ...quote.lines[0], id:'alternative',unitPrice:123 });
  const before = structuredClone(state);
  assert.match(applyCommand(state,{type:'createBidReport',requestId:'m1'},context).message,/Choose an alternative/);
  assert.equal(applyCommand(state,{type:'createBidReport',requestId:'m1',comparisonSelections:{[quote.id]:{[itemId]:'not-matching'}}},context).ok,false);
  const result = applyCommand(state,{type:'createBidReport',requestId:'m1',comparisonSelections:{[quote.id]:{[itemId]:'alternative'}}},context);
  assert.equal(result.ok,true,result.message); assert.equal(result.snapshot.bidReports[0].comparisonRevision,2);
  assert.equal(result.snapshot.bidReports[0].comparisonSelections[quote.id][itemId],'alternative'); assert.deepEqual(result.snapshot.pos,before.pos); assert.deepEqual(state,before);
  quote.lines[1].unitPrice=999; assert.equal(result.snapshot.bidReports[0].data.offers[0].quote.lines[1].unitPrice,123);
  const invalid=structuredClone(result.snapshot.bidReports[0]); invalid.comparisonSelections[quote.id][itemId]='unknown'; assert.equal(validBidReport(invalid),false);
  delete invalid.comparisonSelections; assert.equal(validBidReport(invalid),false);
});

test('new capture includes one latest finalized PHP bid per supplier, while legacy capture keeps its semantics', () => {
  const { state }=fixture(), first=state.quotes[0];
  state.quotes.push({...structuredClone(first),id:'latest-independent',version:2});
  state.quotes.push({...structuredClone(first),id:'draft',version:3,reviewStatus:'draft'});
  state.quotes.push({...structuredClone(first),id:'usd-latest',version:4,currency:'USD'});
  const data=captureBidReport(state,'m1',true);
  assert.deepEqual(data.offers.filter(value=>value.source!=='PO source').map(value=>value.quote.id),['q2','latest-independent']);
  assert.ok(captureBidReport(state,'m1').offers.some(value=>value.quote.id===first.id && value.source!=='PO source'));
});

test('dynamic PDFs contain only actual suppliers and genuine continuation; all quotation links are clickable', async () => {
  for(const count of [1,3,11,12]) {
    const {report}=fixture(), source=report.data.offers[0], originals=structuredClone(report.data.offers);
    report.data.offers=Array.from({length:count},(_,n)=>({...structuredClone(source),source:'Latest bid',supplierName:`Bidder ${n+1}`,quote:{...structuredClone(source.quote),id:`quote-${n}`,supplierId:`supplier-${n}`,terms:'30 days',deliveryTerms:'Delivery after receipt of the purchase order, during scheduled office hours.',archive:{status:'complete',files:[{name:'Original quotation.pdf',url:`https://drive.google.com/file/d/source-${n}/view`},{name:'Additional quotation.pdf',url:`https://drive.google.com/file/d/extra-${n}/view`}]}}}));
    // Retain the PO source only when it belongs to the frozen award history.
    report.data.offers.push(...originals.map(offer=>({...offer,source:'PO source'})));
    report.comparisonSelections=resolveComparisonSelections(report.data);
    const pdf=await PDFDocument.load(await generateBidPdf(report)); assert.equal(pdf.getPageCount(),count===12?2:1);
    assert.deepEqual(pdf.getPage(0).getSize(),{width:792,height:612});
    const all=pdf.getPages().flatMap(page=>pageText(pdf,page)); assert.match(all.map(line=>line.text).join(' '),new RegExp(`SUPPLIER ${String.fromCharCode(64+count)}`));
    assert.doesNotMatch(all.map(line=>line.text).join(' '),new RegExp(`SUPPLIER ${String.fromCharCode(65+count)}(?![A-Z])`));
    for(const page of pdf.getPages()) {
      const text=pageText(pdf,page), deliveries=text.filter(value=>/Delivery after receipt|scheduled office hours/.test(value.text)), links=text.filter(value=>/quotation.pdf/.test(value.text));
      assert.ok(Math.min(...deliveries.map(value=>value.y))>Math.max(...links.map(value=>value.y)));
      const annotations=page.node.lookup(PDFName.of('Annots'));
      assert.ok(annotations.size()>=2);
      assert.match(annotations.lookup(0).lookup(PDFName.of('A')).lookup(PDFName.of('URI')).decodeText(),/^https:\/\/drive.google.com/);
    }
    assert.equal(buildBidWorkbook(report).worksheets[0].columnCount,5+count*2);
  }
});

test('long comparison contents continue completely within one Excel worksheet and genuine PDF pages', async () => {
  const {report}=fixture(); const full='Long specification including dimensional requirements '.repeat(140)+' FINAL SPECIFICATION'; report.data.request.items[0].name=full;
  const sheet=buildBidWorkbook(report).worksheets[0];
  const heading=sheet.getRows(1,sheet.rowCount).find(row=>normalized(row.getCell(2).value)==='DESCRIPTION').number;
  const total=sheet.getRows(1,sheet.rowCount).find(row=>/^(GRAND|INCOMPLETE) TOTAL$/.test(normalized(row.getCell(6).value))).number;
  const description=sheet.getRows(heading+1,total-heading-1).map(row=>row.getCell(2).value||'').join(' ');
  assert.equal(normalized(description),normalized(full)); assert.ok(sheet.getRows(1,sheet.rowCount).every(row=>row.height<=409.5));
  const pdf=await PDFDocument.load(await generateBidPdf(report)); assert.ok(pdf.getPageCount()>1); assert.match(pdf.getPages().flatMap(page=>pageText(pdf,page)).map(value=>value.text).join(' '),/FINAL SPECIFICATION/);
});

test('PO keeps the full MRF reference and ordinary shipping terms on one page; MRF formats values without changing inputs', async () => {
  const {state}=fixture(), request=state.requests[0], po=state.pos[0], quote=state.quotes.find(value=>value.id===po.quoteId), site=state.sites[0];
  initializePoDocument(po,request,quote,site,context.now()); request.ref='MRF-TRAUMA-HML-384'; po.document.shippingTerms='DELIVERY AFTER RECEIPT OF PURCHASE ORDER';
  request.requestedBy='Arriane Aya'; request.signatoryTitles=['Do not print this job title'];
  request.documents=[{name:'MixedCase attachment.pdf',type:'Supporting PDF',fileId:'support'}];
  const before=structuredClone(request);
  const pdf=await PDFDocument.load(await generatePoPdf(po,request,quote,site.name)); assert.equal(pdf.getPageCount(),1);
  const text=pageText(pdf,pdf.getPage(0)).map(value=>value.text).join(' '); assert.match(text,/MRF-TRAUMA-HML-384/); assert.match(text,/DELIVERY AFTER RECEIPT OF PURCHASE ORDER/); assert.doesNotMatch(text,/Shipping terms:/i);
  const mrf=await PDFDocument.load(await generateMrfPdf(request,'Mixed Case Project',site.location,'https://drive.google.com/file/d/support/view'));
  const mrfText=mrf.getPages().flatMap(page=>pageText(mrf,page)).map(value=>value.text).join(' ');
  assert.match(mrfText,/MIXED CASE PROJECT/); assert.match(mrfText,/PORTLAND CEMENT/); assert.match(mrfText,/ARRIANE AYA/); assert.match(mrfText,/MixedCase attachment.pdf/); assert.doesNotMatch(mrfText,/Do not print|DO NOT PRINT/); assert.deepEqual(request,before);
  po.lines=Array.from({length:60},(_,n)=>({...po.lines[0],quantity:n+1})); const long=await PDFDocument.load(await generatePoPdf(po,request,quote,site.name)); assert.ok(long.getPageCount()>1); assert.match(pageText(long,long.getPages().at(-1)).map(value=>value.text).join(' '),/60/);
});
