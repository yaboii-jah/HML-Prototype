import { buildShowcase } from '../../src/mock/fixtures/showcase.ts';
import ExcelJS from 'exceljs';
import { writeFile } from 'node:fs/promises';
const {snapshot}=buildShowcase('audit-origin-links',new Date());
const results=[];
for(const origin of ['http://localhost:3100','http://127.0.0.1:3100']){
  const response=await fetch(origin+'/api/bid-comparisons?format=xlsx',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(snapshot.bidReports[0])});
  if(!response.ok){results.push({origin,status:response.status,error:await response.text()});continue;}
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await response.arrayBuffer());
  const links=[];workbook.eachSheet(sheet=>sheet.eachRow(row=>row.eachCell(cell=>{if(cell.value?.hyperlink)links.push(cell.value.hyperlink);})));
  results.push({origin,status:response.status,inputLinks:snapshot.bidReports[0].data.offers.flatMap(offer=>offer.quote.archive?.files.map(file=>file.url)||[]),links,origins:[...new Set(links.map(link=>new URL(link).origin))],matchesBrowserOrigin:links.every(link=>new URL(link).origin===origin)});
}
await writeFile('artifacts/app-audit/origin-link-probe.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
