import { writeFile } from 'node:fs/promises';
import { buildShowcase } from '../../src/mock/fixtures/showcase.ts';
import { localArchiveFiles } from '../../src/domain/local-files.ts';
import { today } from '../../src/domain/format.ts';
import { philippineDate } from '../../src/domain/credit-terms.ts';
import { coreFlowScenarios } from '../../scripts/core-flow-scenarios.mjs';

const RealDate=Date;
const fixed='2026-10-15T16:30:00.000Z';
globalThis.Date=class extends RealDate {
  constructor(...args){super(...(args.length?args:[fixed]));}
  static now(){return RealDate.parse(fixed);}
};
const clock={instant:fixed,paymentDefault:today(),philippineCalendarDay:philippineDate()};
globalThis.Date=RealDate;
const {snapshot,documents}=buildShowcase('audit-installation-2026',new Date(fixed));
const files=localArchiveFiles(snapshot);
const mismatches=files.flatMap(file=>{
  const original=documents.find(doc=>doc.id===file.id);
  return original&&original.name!==file.name?[{id:file.id,listedName:file.name,actualName:original.name,ownerId:file.ownerId}]:[];
});
const duplicates=[...new Set(files.map(file=>file.projectId+'|'+file.name))].flatMap(key=>{
  const same=files.filter(file=>file.projectId+'|'+file.name===key);
  return same.length>1?[{projectId:same[0].projectId,name:same[0].name,count:same.length,fileIds:same.map(file=>file.id)}]:[];
});
const scenarios=coreFlowScenarios();
const result={clock,localFiles:{count:files.length,mismatchedCount:mismatches.length,mismatches:mismatches.slice(0,14),duplicateLabels:duplicates.slice(0,12)},coreFlow:Object.fromEntries(Object.entries(scenarios).map(([key,value])=>[key,Array.isArray(value)?{length:value.length,sample:value.slice(0,3).map(row=>row.title||row.type||row.id)}:typeof value]))};
await writeFile('artifacts/app-audit/domain-probes.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
