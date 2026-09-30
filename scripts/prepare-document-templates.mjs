import fs from 'node:fs';
import zlib from 'node:zlib';
import { PDFDocument, PDFName, PDFArray, decodePDFRawStream } from 'pdf-lib';

// Rebuild blank backgrounds from the supplied references; transaction text and links are removed.
const sources = { po:process.argv[2] || 'C:/Users/OJT/Desktop/SAMPLE P.O.pdf', comparison:process.argv[3] || 'C:/Users/OJT/Desktop/SAMPLE COMPARISON.pdf', mrf:process.argv[4] || 'C:/Users/OJT/Desktop/SAMPLE PURCHASE REQUISITION.pdf' };
const retained = new Set(['PURCHASE ORDER','HML Technologies and Services Inc.','TIN: 010-164-458-00000','The Regalia Park Tower B, Unit 801/812','150 P. Tuazon Blvd., Cubao, Quezon City','DATE','P.O. #','MRF #','MRF LINK','VAT','NON-VAT','VENDOR','VENDOR BANK DETAILS','SHIP TO','REQUISITIONER','TERMS','F.O.B.','SHIPPING TERMS','ITEM #','DESCRIPTION','QTY','UNIT','UNIT PRICE','TOTAL','SUBTOTAL','EWT (GOODS)','EWT (SERVICES)','Other Comments or Special Instructions','MATERIAL REQUEST FORM','Project Name:','Location:','M.R.F.No.:','Request Date:','ITEM NO.','DATE NEEDED','PURPOSE','LOCATION','REMARKS','Comments/Special Instructions','Attachments:','REQUESTED BY','APPROVED BY','PURCHASER / PROCUREMENT OFFICER','FINANCE OFFICER','PROJECT','DATE','MRF NO.','Business Name','Office Location/Supply','Location','Contact Person','Contact No./email','Link to accreditation','documents','Supplier','Information','BOQ AMOUNT','UNIT COST','TOTAL COST','GRAND','Lead Time','Payment Terms','Delivery Schedule','Link to Quotation','Proposal','Terms and','Schedule']);
function cmap(text) {
 const map=new Map();
 for(const part of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for(const entry of part[1].matchAll(/<([a-f\d]+)>\s*<([a-f\d]+)>/gi)) {
   const bytes=Buffer.from(entry[2],'hex'); let chars=''; for(let i=0;i<bytes.length;i+=2)chars+=String.fromCharCode(bytes.readUInt16BE(i)); map.set(parseInt(entry[1],16),chars);
 }
 for(const part of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for(const entry of part[1].matchAll(/<([a-f\d]+)>\s*<([a-f\d]+)>\s*(<([a-f\d]+)>|\[([^\]]+)\])/gi)) {
   const start=parseInt(entry[1],16),end=parseInt(entry[2],16), list=entry[5]?.match(/<[^>]+>/g);
   for(let n=start;n<=end;n++)map.set(n,String.fromCodePoint(list?parseInt(list[n-start].slice(1,-1),16):parseInt(entry[4],16)+n-start));
 } return map;
}
function literal(input) {
 const bytes=[];for(let i=0;i<input.length;i++){if(input[i]!=='\\'){bytes.push(input.charCodeAt(i));continue;} const tail=input.slice(++i);const oct=tail.match(/^[0-7]{1,3}/);if(oct){bytes.push(parseInt(oct[0],8));i+=oct[0].length-1;}else {const c=input[i];if(c==='\n'||c==='\r')continue;bytes.push(({n:10,r:13,t:9,b:8,f:12})[c]??c.charCodeAt(0));}}return Buffer.from(bytes);
}
fs.mkdirSync('src/server/document-assets',{recursive:true});
fs.mkdirSync('.next/template-analysis',{recursive:true});
for(const [kind,name] of Object.entries(sources)) {
 const doc=await PDFDocument.load(fs.readFileSync(name)); const page=doc.getPage(0),fonts=page.node.Resources().lookup(PDFName.of('Font'));const maps=new Map();
 for(const [key,ref] of fonts.entries()){const font=doc.context.lookup(ref),unicode=font.lookup(PDFName.of('ToUnicode'));if(unicode)maps.set(key.asString().slice(1),cmap(Buffer.from(decodePDFRawStream(unicode).decode()).toString('latin1')));}
 const contents=page.node.lookup(PDFName.of('Contents'));const streams=contents instanceof PDFArray?contents.asArray().map(ref=>doc.context.lookup(ref)):[contents];const raw=streams.map(s=>Buffer.from(decodePDFRawStream(s).decode()).toString('latin1')).join('\n'); const runs=[];
 let clean=raw.replace(/BT\b([\s\S]*?)\bET/g,(block,body)=>{
   const font=body.match(/\/(\w+)\s+[\d.]+\s+Tf/)?.[1];const map=maps.get(font);let text='';
   for(const match of body.matchAll(/<([a-f\d]+)>|\(((?:\\[\s\S]|[^\\)])*)\)/gi)){const bytes=match[1]?Buffer.from(match[1],'hex'):literal(match[2]);for(let i=0;i+1<bytes.length;i+=2)text+=map?.get(bytes.readUInt16BE(i))??'';}
   const normalized=text.trim().replace(/\s+/g,' ');runs.push({text:normalized,body});
   return retained.has(normalized)||/^SUPPLIER [A-K]$/.test(normalized)?block:'';
 });
 if(kind==='comparison') clean=clean.replace(/([\d.]+) (856\.5|872\.5|888\.5) m\s+[\d.]+ \2 l\s+S/g,(line,x)=>Number(x)>=609?'':line);
 page.node.set(PDFName.of('Contents'),doc.context.register(doc.context.flateStream(Buffer.from(clean,'latin1'))));page.node.delete(PDFName.of('Annots'));
 doc.setTitle(`${kind} blank company template`);doc.setAuthor('');doc.setSubject('');doc.setCreator('HML ConstructSync');
 const blank=await PDFDocument.create(); const [blankPage]=await blank.copyPages(doc,[0]);blank.addPage(blankPage);blank.setTitle(`${kind} blank company template`);blank.setCreator('HML ConstructSync');
 fs.writeFileSync(`src/server/document-assets/${kind}.pdf`,await blank.save());fs.writeFileSync(`.next/template-analysis/${kind}-runs.json`,JSON.stringify(runs,null,2));
 // Extract lossless original artwork for previews/worksheet reuse.
 const objects=page.node.Resources().lookup(PDFName.of('XObject'));
 if(objects)for(const [,ref] of objects.entries()) {const obj=doc.context.lookup(ref);if(obj.dict?.get(PDFName.of('Subtype'))?.asString()!=='/Image')continue; const width=obj.dict.lookup(PDFName.of('Width')).asNumber(),height=obj.dict.lookup(PDFName.of('Height')).asNumber();const rgb=decodePDFRawStream(obj).decode();const mask=obj.dict.lookup(PDFName.of('SMask'));const alpha=mask?decodePDFRawStream(mask).decode():null;const rows=Buffer.alloc(height*(1+width*4));for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*width+x,t=y*(1+width*4)+1+x*4;rows[t]=rgb[p*3];rows[t+1]=rgb[p*3+1];rows[t+2]=rgb[p*3+2];rows[t+3]=alpha?.[p]??255;}
 const crc=(buf)=>{let c=0xffffffff;for(const b of buf){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}; const chunk=(type,data)=>{const tag=Buffer.from(type),len=Buffer.alloc(4),check=Buffer.alloc(4);len.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([tag,data])));return Buffer.concat([len,tag,data,check]);};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;fs.writeFileSync(`src/server/document-assets/${kind}-logo.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]));break; }
 console.log(kind,runs.map(r=>r.text).join(' | '));
}
for(const [name,source] of [['arial','arial.ttf'],['arial-bold','arialbd.ttf']])fs.copyFileSync(`C:/Windows/Fonts/${source}`,`src/server/document-assets/${name}.ttf`);
