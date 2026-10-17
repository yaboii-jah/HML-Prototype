import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { entities, stores, processes, boundaryFlows, contextFlows, storeFlows, diagrams, supplierExchangeNote } from "./model.mjs";

const directory = new URL("./", import.meta.url);
const entityMap = new Map(entities.map(entity => [entity.id,entity]));
const storeMap = new Map(stores.map(store => [store.id,store]));
const processMap = new Map(processes.map(process => [process.id,process]));
assert.equal(entityMap.size,10); assert.equal(processMap.size,6); assert.equal(storeMap.size,6);
const sorted = values => [...new Set(values)].sort();
const approved = JSON.parse(await readFile(new URL("approved-flows.json",directory),"utf8"));
assert.deepEqual(boundaryFlows.map(({from,to,data})=>({from,to,data})),approved.boundary,"Approved boundary information changed");
assert.deepEqual(storeFlows.map(({from,to})=>({from,to})),approved.stores.map(({from,to})=>({from,to})),"Approved store connections changed");
for (const entity of entities) {
  for (const incoming of [true,false]) {
    const context = contextFlows.find(flow => incoming ? flow.from === entity.id : flow.to === entity.id);
    const detailed = boundaryFlows.filter(flow => incoming ? flow.from === entity.id : flow.to === entity.id);
    assert.ok(detailed.length > 0, `${entity.name}: needs both input and output`);
    assert.deepEqual(sorted(context.data),sorted(detailed.flatMap(flow => flow.data)),`${entity.name}: context / Level 1 imbalance`);
  }
}
for (const flow of [...boundaryFlows,...storeFlows]) {
  assert.ok(flow.label.trim(),"Every data flow requires a label");
  assert.ok(processMap.has(flow.from) || processMap.has(flow.to),"A flow must touch a process");
  assert.ok(entityMap.has(flow.from) || storeMap.has(flow.from) || processMap.has(flow.from));
  assert.ok(entityMap.has(flow.to) || storeMap.has(flow.to) || processMap.has(flow.to));
}
for (const node of [...processes,...stores]) {
  assert.ok([...boundaryFlows,...storeFlows].some(flow => flow.to === node.id),`${node.id} has no input`);
  assert.ok([...boundaryFlows,...storeFlows].some(flow => flow.from === node.id),`${node.id} has no output`);
}
for (const [name,diagram] of Object.entries(diagrams)) {
  assert.ok(diagram.fontSize * diagram.printWidthMm / diagram.width * 72 / 25.4 >= diagram.minimumPoints,`${name} print font too small`);
}

const quote = value => String(value).replaceAll('"',"'");
const mermaid = context => {
  const lines = ["---","config:","  layout: elk","  theme: base","  flowchart:","    htmlLabels: false","---","flowchart TB"];
  for (const entity of entities) lines.push(`  ${entity.id}["${quote(entity.name)}"]`);
  if (context) lines.push('  P0("0 ConstructSync")');
  else {
    for (const process of processes) lines.push(`  ${process.id}("${process.number} ${quote(process.name)}")`);
    for (const store of stores) lines.push(`  ${store.id}["${store.id} ${quote(store.name)}"]`);
    lines.push("  %% Publication SVG renders open-ended Gane-Sarson data stores; Mermaid uses rectangular proxies.");
  }
  for (const flow of context ? contextFlows : [...boundaryFlows,...storeFlows]) lines.push(`  ${flow.from} -->|"${quote(flow.label)}"| ${flow.to}`);
  const ink = context ? {external:"#000000",process:"#000000",data:"#8a7544",text:"#000000",paper:"#fff8e6"} : {external:"#000000",process:"#365b88",data:"#8a7544",text:"#000000",paper:"#fff8e6"};
  lines.push(`  classDef external fill:#ffffff,stroke:${ink.external},color:${ink.text}`,`  classDef process fill:#e4edf8,stroke:${ink.process},color:${ink.text}`,`  classDef data fill:${ink.paper},stroke:${ink.data},color:${ink.text}`,`  class ${entities.map(entity => entity.id).join(",")} external`,`  class ${context ? "P0" : processes.map(process => process.id).join(",")} process`);
  if (!context) lines.push(`  class ${stores.map(store => store.id).join(",")} data`);
  lines.push(`  %% ${supplierExchangeNote}`);
  return lines.join("\n") + "\n";
};
const flowRegister = ["# DFD flow register","","These are logical data flows, not payment transactions or workflow-control arrows.","","## Level 1 boundary flows","","| External entity | Process | Direction | Display label | Data carried |","|---|---|---|---|---|",...boundaryFlows.map(flow => {
  const input = entityMap.has(flow.from), entity = entityMap.get(input ? flow.from : flow.to), process = processMap.get(input ? flow.to : flow.from);
  return `| ${entity.name} | ${process.number} ${process.name} | ${input ? "Into system" : "Out of system"} | ${flow.label} | ${flow.data.join(", ")} |`;
}),"","## Store flows","","| From | To | Display label | Information carried |","|---|---|---|---|",...storeFlows.map(flow => `| ${flow.from} | ${flow.to} | ${flow.label} | ${approved.stores.find(item=>item.from===flow.from && item.to===flow.to).information} |`),"","## Context balance","","Context labels summarize the exact union of Level 1 boundary data for each entity and direction. The generator checks those sets for equality. This logical view includes Supplier as the original source of quotations and the intended recipient of issued purchase orders. Procurement's flows carry reviewed quotation data and sourcing/PO decisions, rather than duplicating the supplier document exchanges.","",supplierExchangeNote,""];
const readme = `# ConstructSync data flow diagrams

Two figures describe the current revised workflow using Gane–Sarson notation. This is a proposed logical production view based on authenticated users and shared persistent company records, not browser-local prototype storage. It is not a physical database schema or a claim that production infrastructure is installed. See the [production design basis](../PRODUCTION_DESIGN.md).

## Figures

- [Context PDF](constructsync-context.pdf), [PNG](constructsync-context.png), [SVG](constructsync-context.svg), [Mermaid](constructsync-context.mmd): one light blue ConstructSync process with black text and lines, with five external entities above and five below. The horizontal figure measures 27.7 × 14.8 cm; insert at 27.7 cm wide on a landscape page for text of approximately 13.46 pt. The 5600 × 3000 PNG is suitable for pasting into documents; SVG/PDF preserve vector text. The figure contains no explanatory footer; supplier mediation is explained in the accompanying notes. The [previous portrait PDF](previous-portrait/constructsync-context.pdf) remains available.
- [Level 1 PDF](constructsync-level1.pdf), [PNG](constructsync-level1.png), [SVG](constructsync-level1.svg), [Mermaid](constructsync-level1.mmd): six processes and six logical stores. The PDF uses one A4 landscape page with 10 mm margins. Insert it at 27.7 cm wide on a landscape document page: the smallest text is approximately 11.06 pt. Use SVG for sharp scaling or the 8800 × 6000 PNG for pasting into Word/Google Docs. Keep the original aspect ratio and avoid image compression; shrinking it to a portrait text column also shrinks the labels.

Suggested captions, placed outside the images: *Figure X. Context diagram of ConstructSync.* and *Figure Y. Level 1 data flow diagram of ConstructSync.*

Rectangles represent external entities, numbered rounded boxes represent processes, and open-ended boxes represent stores. Directed, labeled arrows carry information. Repeated external entities and stores retain the same names/IDs; they are copies of one logical participant or repository, not additional roles or databases. A doubled left store edge marks a repeated store. Level 1 uses light blue process boxes with blue borders and white external-entity boxes. Text and arrows remain black. D1?D6 stores use pale orange fill and brown borders; shape types distinguish processes, people/systems and stores. Neither image has an internal title or legend.

## Processes

| Process | Purpose |
|---|---|
${processes.map(process => `| ${process.number} ${process.name} | ${process.actors.map(actor => entityMap.get(actor.id).name).join(", ")} supply or receive its business information. |`).join("\n")}

## Important distinctions

- Finance submits payment priorities, planned dates and coordination status. Actual payment occurs outside the app. Accounting supplies archived proof and verifies payments; a Finance plan does not establish that money was paid.
- Upfront needs full verified net payment before Accounting's separate delivery clearance. Credit supports clearance before settlement and multiple partial payments. The diagram carries payment mode, verified balances and clearance as data, not a control-flow decision diamond.
- Supplier is an external source/recipient in this logical business-information view. ${supplierExchangeNote} Its arrows identify document provenance and destination; Procurement's arrows identify reviewed quotation data, sourcing decisions, transfers and PO preparation. No supplier portal or direct integration is implied.
- AI receives MRF/quotation pages and requested-item context; it returns draft fields and match suggestions. Site Personnel/Procurement review them before approved business records are saved. AI cannot approve requests, awards or payments.
- D6 groups source files, temporary extraction drafts and archive metadata at a logical level. Document processing reads source/staged information and returns references/drafts to that logical store; request/procurement/payment processes consume them. This abstracts interactive extraction and archiving, not a new background job or physical extraction-results table.
- Google Drive exchanges folder information, generated PDFs, supporting files, evidence, archive results and retrieved document data. D6 stores document references/staged data, not a second independent Google Drive archive.
- D4 includes payment coordination, verified payments and Accounting delivery-clearance records. D5 distinguishes warehouse receipt from accepted site quantities and inventory movements. Warehouse receiving does not automatically post site stock.
- D1 groups accounts, projects, scopes and budgets; D2 groups requests/items; D3 groups suppliers, quotation/award/bid/PO information, transfer proposals, allocations and source release decisions. Stores group multiple ERD entities; they are not one-to-one mappings to SQL tables.

- Procurement reads D5 site stock and D3 allocations/releases to determine availability and remaining purchase quantities. Proposals and cancellations are retained in D3.
- Source Site Personnel submit release decisions to 5.0; released quantities are retained in D3. Logistics receives approved transfer quantities alongside separately cleared supplier quantities. D5 retains trips, source transfer-out and accepted destination transfer-in movements.
- Transfers bypass 4.0 payment processing and supplier clearance. Accounting reviews transfer receipt evidence through 6.0 without requiring an invoice or payment proof. Site Personnel is one role covering distinct authorized source and destination responsibilities.
- Level 0 and Level 1 are business overviews; no Level 2 is added. See [diagram conventions](../research/diagram-conventions.md).

[Flow register](FLOW_REGISTER.md) lists the data carried by each boundary arrow and all store connections. [Validation](VALIDATION.md) records structural and export checks.

## Regenerate

Edit model.mjs first. Publication diagrams use fixed positions; Mermaid describes the same logical graph with automatic positions and rectangular data-store proxies. Level 1 uses two columns and three rows, with local entities on the left and stores on the right. Separate horizontal lanes keep arrows continuous and labels clear. Necessary repeated symbols avoid long connectors across process groups.

\`\`\`powershell
node docs/thesis/dfd/generate.mjs
node docs/thesis/dfd/generate.mjs --check
node docs/thesis/dfd/export.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"
\`\`\`

The exporter reuses Puppeteer from the previously installed Mermaid CLI package and Edge from the ERD's configuration; app dependencies do not change. SVG/PDF retain vector text and PNGs are high resolution. Add --level1-only to export the revised figure without rewriting the context image files. The fixed approved-flows.json baseline protects existing boundary information and store connections; Level 1 export checks connector crossings, overlapping segments and connector/label collisions.

Sources: [current workflow](../../WORKFLOW.md), [domain records](../../../src/domain/types.ts), and request/quotation extraction and Drive routes under app/api.
`;
for (const [file,content] of new Map([["constructsync-context.mmd",mermaid(true)],["constructsync-level1.mmd",mermaid(false)],["FLOW_REGISTER.md",flowRegister.join("\n")],["README.md",readme]])) {
  if (process.argv.includes("--check")) assert.equal(await readFile(new URL(file,directory),"utf8"),content,`${file} is stale`);
  else await writeFile(new URL(file,directory),content,"utf8");
}
console.log(`Verified balanced DFD model: ${contextFlows.length} context flows, ${boundaryFlows.length} detailed boundary flows, ${storeFlows.length} store flows.`);
