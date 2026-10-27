import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import ExcelJS from 'exceljs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { localArchiveFixture } from './fixtures/local-archive.ts';

registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) return nextResolve(new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  return nextResolve(specifier==='next/server'?'next/server.js':specifier,context);
}});
const { POST } = await import('../app/api/bid-comparisons/route.ts');

test('downloaded XLSX and PDF local source links use the validated browser origin for both loopback aliases', async t => {
  const prior=process.env.VERCEL_ENV;delete process.env.VERCEL_ENV;t.after(()=>{if(prior===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=prior;});
  const report=localArchiveFixture('origin-verification',new Date('2026-10-17T00:00:00Z')).snapshot.bidReports[0];
  for(const browser of ['http://localhost:3100','http://127.0.0.1:3100'])for(const format of ['xlsx','pdf']){
    const req=new Request(`http://localhost:3100/api/bid-comparisons?format=${format}`,{method:'POST',headers:{origin:browser,host:new URL(browser).host,'content-type':'application/json'},body:JSON.stringify(report)});
    const response=await POST(req);assert.equal(response.status,200);const bytes=await response.arrayBuffer(),links=[];
    if(format==='xlsx') {const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);workbook.eachSheet(sheet=>sheet.eachRow(row=>row.eachCell(cell=>{if(cell.value?.hyperlink)links.push(cell.value.hyperlink);})));}
    else {const pdf=await PDFDocument.load(bytes);for(const page of pdf.getPages())for(const annotation of page.node.Annots()?.asArray()||[]){const a=pdf.context.lookup(annotation).lookup(PDFName.of('A'));const uri=a?.lookup(PDFName.of('URI'));if(uri?.decodeText)links.push(uri.decodeText());}}
    const local=links.filter(link=>link.includes('/demo-files/'));assert.ok(local.length>0,`${format} includes source links`);assert.ok(local.every(link=>new URL(link).origin===browser),`${format}: ${browser}`);
  }
  const foreign=new Request('http://localhost:3100/api/bid-comparisons',{method:'POST',headers:{origin:'https://outside.example',host:'localhost:3100'},body:JSON.stringify(report)});
  assert.equal((await POST(foreign)).status,403);
});
