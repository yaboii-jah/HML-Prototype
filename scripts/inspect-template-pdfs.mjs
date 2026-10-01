import fs from 'node:fs';
import { PDFDocument, PDFName, PDFArray, decodePDFRawStream } from 'pdf-lib';
if (process.argv.includes('--runs')) {
 for(const kind of ['po','mrf','comparison']) {const rows=JSON.parse(fs.readFileSync(`.next/template-analysis/${kind}-runs.json`));console.log(kind,JSON.stringify(rows.slice(0,kind==='comparison'?105:110).map(r=>({text:r.text,position:r.body.match(/(?:[-.\d]+\s+){5}[-.\d]+\s+Tm/)?.[0],font:r.body.match(/\/\w+\s+[\d.]+\s+Tf/)?.[0]}))));}
 process.exit(0);
}
for (const name of ['SAMPLE P.O','SAMPLE COMPARISON','SAMPLE PURCHASE REQUISITION']) {
  const doc = await PDFDocument.load(fs.readFileSync(`C:/Users/OJT/Desktop/${name}.pdf`));
  const page = doc.getPage(0);
  const contents = page.node.lookup(PDFName.of('Contents'));
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref=>doc.context.lookup(ref)) : [contents];
  const text = streams.map(s=>Buffer.from(decodePDFRawStream(s).decode()).toString('latin1')).join('\n');
  fs.mkdirSync('.next/template-analysis',{recursive:true});
  fs.writeFileSync(`.next/template-analysis/${name}.txt`,text);
  const fonts = page.node.Resources().lookup(PDFName.of('Font'));
  for(const [key,ref] of fonts.entries()) {
    const font=doc.context.lookup(ref);
    const unicode=font.lookup(PDFName.of('ToUnicode'));
    if(unicode) fs.writeFileSync(`.next/template-analysis/${name}-${key.asString().slice(1)}.txt`,Buffer.from(decodePDFRawStream(unicode).decode()));
  }
  console.log(name,text.slice(0,2200));
}
