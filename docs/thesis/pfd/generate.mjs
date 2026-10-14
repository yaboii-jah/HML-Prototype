import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { diagrams } from "./model.mjs";
import { handoffs } from "./flows.mjs";
import { validateGeometry } from "./layout.mjs";

const directory = new URL("./",import.meta.url);
const byKey = new Map(diagrams.map(diagram => [diagram.key,diagram]));
assert.deepEqual([...byKey.keys()],["A","B","C","D","E","F"]);
for(const handoff of handoffs) {
  const source=byKey.get(handoff.from)?.nodes.find(node=>node.id===handoff.node);
  assert.equal(source?.reference,handoff.to,`Invalid handoff ${handoff.from}/${handoff.node}`);
  assert.ok(byKey.get(handoff.to)?.nodes.some(node=>node.id===handoff.entry),`Missing handoff destination ${handoff.to}/${handoff.entry}`);
}
for(const diagram of diagrams) for(const node of diagram.nodes.filter(node=>node.reference)) {
  assert.ok(handoffs.some(handoff=>handoff.from===diagram.key && handoff.node===node.id),`Missing handoff mapping ${diagram.key}/${node.id}`);
}
export function reaches(diagram,from,to,excluded=[]) {
  const seen = new Set(excluded), pending = [from], links = [...diagram.edges,...(diagram.continuations || [])];
  while(pending.length) {
    const id = pending.shift();
    if(seen.has(id)) continue;
    if(id === to) return true;
    seen.add(id); pending.push(...links.filter(link => link.from === id).map(link => link.to));
  }
  return false;
}
export function validate(diagram) {
  validateGeometry(diagram);
  const {nodes,edges,page,entryIds} = diagram, ids = new Set(nodes.map(node => node.id));
  const links = [...edges,...(diagram.continuations || [])];
  const figureReference = /\([A-F]\)|\b(?:from|in|via|to)\s+[A-F]\b|\b[A-F]\s*:|\bCR\b/;
  for(const label of [diagram.explanation,...diagram.notes,...nodes.flatMap(node => node.lines),...edges.map(edge => edge.label)]) {
    assert.ok(!figureReference.test(label),`Use a descriptive event or process instead of a figure letter: ${label}`);
  }
  assert.equal(ids.size,nodes.length,"Unique node IDs required");
  assert.ok(page.fontSize*page.printWidthMm/page.width*72/25.4 >= page.minimumPoints);
  const paperHeight = page.orientation === "portrait" ? 277 : 190;
  assert.ok(page.height/page.width*page.printWidthMm <= paperHeight,"Figure must fit the page without font shrinkage");
  for(const id of entryIds) assert.ok(ids.has(id),`Unknown entry ${id}`);
  for(const node of nodes) {
    assert.ok(entryIds.some(id => reaches(diagram,id,node.id)),`Unreachable ${diagram.key}/${node.id}`);
    assert.ok(node.x>=0 && node.y>=0 && node.x+node.w<=page.width && node.y+node.h<=page.height,`Outside canvas: ${node.id}`);
    if(!entryIds.includes(node.id)) assert.ok(links.some(link => link.to===node.id),`Missing predecessor: ${node.id}`);
    if(!["terminal","reference"].includes(node.type)) assert.ok(links.some(link => link.from===node.id),`Missing successor: ${node.id}`);
    if(node.reference) assert.ok(byKey.has(node.reference),`Unknown chart reference: ${node.reference}`);
    if(node.type === "decision") {
      const outcomes = edges.filter(edge => edge.from === node.id);
      assert.ok(outcomes.length>=2 && outcomes.every(edge => edge.label),`Decision needs named outcomes: ${node.id}`);
    }
  }
  for(const edge of edges) {
    assert.ok(ids.has(edge.from) && ids.has(edge.to));
    if(edge.label) assert.ok(edge.labelAt,`Missing label position: ${edge.from}/${edge.to}`);
    for(const [x,y] of edge.points) assert.ok(x>=0 && y>=0 && x<=page.width && y<=page.height);
  }
  for(const link of diagram.continuations || []) {
    for(const id of [link.from,link.to]) {
      const symbol = nodes.find(node => node.id===id);
      assert.equal(symbol?.type,"connector"); assert.deepEqual(symbol.lines,[link.label]);
    }
  }
  for(const id of ["mrfRejected","poRejected","inventoryPosted","documentsReviewed","creditSettled"].filter(id => ids.has(id))) {
    assert.ok(!links.some(link => link.from===id),`Milestone must not close another path: ${id}`);
  }
  if(diagram.key === "A") {
    assert.ok(reaches(diagram,"mrfDecision","submitMrf"));
    assert.deepEqual(edges.filter(edge => edge.from==="sourceMaterials").map(edge => edge.to),["purchase","transfer"]);
    assert.ok(reaches(diagram,"transfer","receiving",["purchase"]));
    assert.ok(reaches(diagram,"purchase","receiving",["transfer"]));
    assert.ok(reaches(diagram,"sourceMaterials","receiving",["transfer"]),"Purchase-only fulfillment must be possible");
    assert.ok(reaches(diagram,"sourceMaterials","receiving",["purchase"]),"Transfer-only fulfillment must be possible");
    assert.equal(nodes.find(node=>node.id==="documentation").reference,"F");
  } else if(diagram.key === "B") {
    assert.ok(reaches(diagram,"poDecision","draftPo"));
    assert.ok(edges.some(edge => edge.from==="reviewPo" && edge.to==="reviewPo" && edge.label==="Hold"));
    assert.ok(reaches(diagram,"issuePo","paymentHandling"));
    assert.equal(nodes.find(node=>node.id==="paymentHandling").reference,"C");
    assert.ok(!nodes.some(node=>/coordinate payment|verify payment|balance settled/i.test(node.lines.join(" "))));
  } else if(diagram.key === "C") {
    assert.deepEqual(edges.filter(edge => edge.from==="paymentMode").map(edge => edge.label),["Upfront","Credit / terms"]);
    assert.ok(!reaches(diagram,"upfrontFinance","upfrontDelivery",["fullPaymentVerified"]),"Upfront must require payment verification");
    assert.ok(reaches(diagram,"upfrontFinance","upfrontDelivery"));
    assert.ok(reaches(diagram,"creditPaths","creditDelivery",["creditFinance","creditVerify","balanceSettled","creditSettled"]));
    assert.ok(reaches(diagram,"creditPaths","creditSettled",["creditClearance","creditDelivery"]));
    assert.ok(!reaches(diagram,"creditFinance","creditDelivery"),"Credit settlement must not retrigger clearance");
  } else if(diagram.key === "D") {
    assert.ok(reaches(diagram,"siteSuitability","proposeTransfer",["suitabilityResourcing"]));
    assert.ok(!reaches(diagram,"siteSuitability","proposeTransfer",["suitabilityDecision"]));
    assert.ok(reaches(diagram,"suitabilityDecision","suitabilityResourcing"));
    assert.ok(!reaches(diagram,"proposeTransfer","transferReceiving",["sourceRelease"]),"Source release is required");
    assert.ok(reaches(diagram,"sourceRelease","resourcing"));
    assert.ok(reaches(diagram,"sourceRelease","transferReceiving"));
    assert.ok(reaches(diagram,"recordRelease","resourcing"),"Reduced release returns the remainder to sourcing");
    assert.ok(!reaches(diagram,"recordRelease","transferReceiving",["dispatchTransfer"]));
    assert.equal(nodes.find(node=>node.id==="transferReceiving").reference,"E");
    assert.ok(!nodes.some(node => /finance|payment|quotation|purchase order/i.test([node.role,node.lines].flat().join(" "))),"Transfer must bypass purchasing and payment");
  } else if(diagram.key === "E") {
    assert.ok(reaches(diagram,"deliveryRoute","siteReceipt",["warehouseReceipt","warehouseTransfer"]));
    assert.ok(reaches(diagram,"warehouseReceipt","siteReceipt"));
    assert.ok(reaches(diagram,"warehouseReceipt","warehouseDocuments",["warehouseTransfer","siteReceipt","postInventory"]),"Warehouse evidence must not wait for site arrival");
    assert.ok(reaches(diagram,"transferDispatched","inventoryPosted",["supplierReady","scheduleDelivery","deliveryRoute","warehouseReceipt"]));
    assert.ok(reaches(diagram,"siteReceipt","inventoryPosted",["siteDocuments","transferShortage"]));
    assert.ok(reaches(diagram,"siteReceipt","siteDocuments",["postInventory"]));
    assert.ok(reaches(diagram,"siteReceipt","shortageResourcing",["postInventory","siteDocuments"]));
    for(const id of ["warehouseDocuments","siteDocuments"]) assert.equal(nodes.find(node=>node.id===id).reference,"F");
    assert.equal(nodes.find(node=>node.id==="shortageResourcing").reference,"A");
    assert.ok(!nodes.some(node=>/review required evidence|archive generated/i.test(node.lines.join(" "))));
  } else {
    assert.ok(reaches(diagram,"receiptEvidence","documentsReviewed"));
    assert.ok(!reaches(diagram,"receiptEvidence","documentsReviewed",["evidenceAccepted"]));
    assert.ok(reaches(diagram,"evidenceAccepted","archiveReceipts",["documentsReviewed"]));
    assert.ok(!nodes.some(node=>/post.*stock|coordinate payment|clear delivery/i.test(node.lines.join(" "))));
  }
  return `${diagram.name}: ${nodes.length} symbols, ${edges.length} connectors, ${(diagram.continuations || []).length} named continuations verified`;
}

const quote = value => String(value).replaceAll('"',"'");
const source = diagram => {
  const lines = ["---","config:","  layout: elk","  theme: neutral","  flowchart:","    htmlLabels: false","---",`flowchart ${diagram.direction}`,`  %% ${diagram.name}`,"  %% Descriptive events identify entries; named process handoffs use off-page pentagons in publication exports."];
  for(const node of diagram.nodes) {
    const label = quote([...(node.role ? [node.role].flat() : []),...node.lines].join("; "));
    lines.push(`  ${node.id}${node.type==="connector" ? `(("${label}"))` : node.type==="decision" ? `{"${label}"}` : node.type==="terminal" ? `(["${label}"])` : node.type==="subprocess" ? `[["${label}"]]` : `["${label}"]`}`);
  }
  for(const edge of diagram.edges) lines.push(`  ${edge.from} -->${edge.label ? `|"${quote(edge.label)}"|` : ""} ${edge.to}`);
  for(const link of diagram.continuations || []) lines.push(`  %% ${link.label} continues from ${link.from} to ${link.to}`,`  ${link.from} ~~~ ${link.to}`);
  lines.push("  classDef plain fill:#ffffff,stroke:#000000,color:#000000",`  class ${diagram.nodes.map(node => node.id).join(",")} plain`);
  return lines.join("\n")+"\n";
};
const readme = [
  "# ConstructSync process flowcharts","","Six connected business figures describe the intended production workflow. The request and fulfillment overview introduces five focused flows: purchasing, payments, site transfers, receiving/inventory and receipt review. Each uses descriptive entry events and process handoffs. See the [production design basis](../PRODUCTION_DESIGN.md).","",
  "## Active figures","","| Figure | PDF | Image | Vector | Editable source |","|---|---|---|---|---|",
  ...diagrams.map(diagram => `| ${diagram.name} | [PDF](constructsync-${diagram.id}.pdf) | [PNG](constructsync-${diagram.id}.png) | [SVG](constructsync-${diagram.id}.svg) | [Mermaid](constructsync-${diagram.id}.mmd) |`),"",
  "Use the request and fulfillment overview as the main figure and the five focused flows as supporting figures. Add captions outside the images and assign the paper's figure numbers separately. Supplier PO issuance begins payment coordination; delivery clearance begins supplier delivery scheduling; site-transfer dispatch begins destination receiving. Warehouse or site receipt evidence begins documentation and review.","",
  "## Reading and print layout","",
  "The overview, purchasing, site transfer and receipt-review figures use A4 portrait. Payment coordination and delivery/receiving use A4 landscape. All PDFs have 10 mm margins. Keep portrait images at 19 cm and landscape images at 27.7 cm wide, with their aspect ratios preserved. Printed labels are at least 10 pt. SVG/PDF retain selectable vector text; PNGs are generated at four times the canvas size.","",
  "Activities read downward and alternative branches sit beside each other. White shapes, black text and arrows, consistent spacing, and bold responsible roles preserve the paper style. No internal title or legend is inserted.","",
  "Rectangles are activities; diamonds are decisions; rounded symbols are entries or recorded milestones. Double-sided rectangles refer to named subprocesses. Pentagons identify the next process, not automatic system closure. The Credit connector routes independent delivery-clearance and payment paths. Warehouse and site receipt evidence each proceeds to receipt review without waiting for the other path.","",
  "## What changed and why","",
  "- Starting events and named process handoffs replace figure letters, so each flow can be understood independently of its caption or position in the paper.",
  "- Entry and handoff shapes are resized, and their connector ports are adjusted, to keep the longer descriptive labels readable.",
  "- Purchasing and PO approval remain separate from payment coordination and clearance, making responsibility and payment gates easier to follow.",
  "- Required destination suitability review precedes Procurement's release proposal. Reduced/rejected releases and transfer shortages return explicitly to material sourcing.",
  "- Warehouse evidence can reach receipt review before goods arrive at the site, and site stock posting never waits for document review.",
  "- The overview begins with a ready project and marks purchasing/transfer quantities as applicable, preserving purchase-only, transfer-only and mixed requests.","",
  ...diagrams.flatMap(diagram => [`## ${diagram.name}`,"",diagram.explanation,"",...diagram.notes.map(note => `- ${note}`),""]),
  "## Details kept in notes","",
  "MRFs and supplier quotations retain reviewed supporting files and archive requirements. PO review includes VAT/EWT, adjustments and budget checks. Stock matching requires compatible units and Procurement suitability confirmation. Project assignments control source release and destination receipt/posting. Detailed reservation, cancellation, shortage, evidence-version and archive-retry rules remain in [the workflow](../../WORKFLOW.md) rather than adding screen-level boxes.","",
  "Receipt evidence review remains independent of payment settlement and stock posting. Transfer receipts require no supplier invoice or payment proof. Generated and current signed receipts must cover every received trip, including warehouse batches. Material usage continues after stock posting and is not a completion gate.","",
  "## Historical figures","",
  "The [previous four-figure set](previous-four-figure/ARCHIVE.md) retains its original labels and is not the active version. The [former combined chart](constructsync-combined.pdf), [former upfront chart](constructsync-upfront.pdf), and [former credit chart](constructsync-credit-terms.pdf) remain historical files. Use the six active figures above; regeneration does not overwrite the archives.","",
  "## Regenerate","","Edit flows.mjs for current business content and fixed publication positions. model.mjs re-exports those figures and retains historical definitions. Mermaid uses automatic layout; publication SVGs use the checked fixed positions.","","```powershell","node docs/thesis/pfd/generate.mjs","node docs/thesis/pfd/generate.mjs --check",'node docs/thesis/pfd/export.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"',"```","",
  "The exporter reuses the installed PDF utilities, cached Puppeteer and Edge; application dependencies and behavior do not change. [Validation](VALIDATION.md) records structural, cross-chart, geometry and rendered-text checks. [Diagram conventions](../research/diagram-conventions.md) explains the modeling sources.","",
];
for(const diagram of diagrams) console.log(validate(diagram));
for(const [file,content] of [...diagrams.map(diagram => [`constructsync-${diagram.id}.mmd`,source(diagram)]),["README.md",readme.join("\n")]]) {
  const target = new URL(file,directory);
  if(process.argv.includes("--check")) assert.equal(await readFile(target,"utf8"),content,`Regenerate ${file}`);
  else await writeFile(target,content,"utf8");
}
