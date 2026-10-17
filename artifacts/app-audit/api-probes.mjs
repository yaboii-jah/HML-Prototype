import { registerHooks } from 'node:module';
import { writeFile } from 'node:fs/promises';
registerHooks({resolve(specifier,context,nextResolve){return nextResolve(specifier==='next/server'?'next/server.js':specifier,context);}});
const { POST:quote }=await import('../../app/api/quotes/extract/route.ts');
const { POST:mrf }=await import('../../app/api/requests/extract/route.ts');
const originalFetch=globalThis.fetch;
const originalKey=process.env.GEMINI_API_KEY;
let providerCalls=0;
process.env.GEMINI_API_KEY='audit-dummy-key-never-sent';
globalThis.fetch=async()=>{
  providerCalls++;
  return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({supplier:'Audit supplier',lines:[{description:'Audit material',quantity:1,unitPrice:1}]})}]}}]});
};
const request=(route,origin,bytes)=>{
  const form=new FormData();form.append('files',new File([bytes],'quotation.pdf',{type:'application/pdf'}));
  return new Request('http://localhost:3100'+route,{method:'POST',headers:{Origin:origin,Host:'localhost:3100'},body:form});
};
const results=[];
try{
  for(const [name,handler,req] of [
    ['Quotation extraction with foreign Origin',quote,request('/api/quotes/extract','https://untrusted.example','%PDF-1.4 audit')],
    ['MRF extraction with foreign Origin',mrf,request('/api/requests/extract','https://untrusted.example','%PDF-1.4 audit')],
    ['Quotation extraction with forged PDF MIME',quote,request('/api/quotes/extract','http://localhost:3100','This is plain text, not a PDF')],
    ['MRF extraction with forged PDF MIME',mrf,request('/api/requests/extract','http://localhost:3100','This is plain text, not a PDF')],
    ['Quotation extraction with malformed multipart',quote,new Request('http://localhost:3100/api/quotes/extract',{method:'POST',headers:{Origin:'http://localhost:3100','Content-Type':'multipart/form-data; boundary=audit'},body:'not a multipart body'})]
  ]){
    const before=providerCalls;
    try{const response=await handler(req);results.push({name,status:response.status,providerCalls:providerCalls-before,body:await response.json()});}
    catch(error){results.push({name,thrown:String(error),providerCalls:providerCalls-before});}
  }
}finally{
  globalThis.fetch=originalFetch;
  if(originalKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=originalKey;
}
await writeFile('artifacts/app-audit/api-probes.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
