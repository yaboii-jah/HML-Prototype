import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { model, boxWidth, boxHeight, cardinality } from "./model.mjs";
import { validateGeometry } from "../pfd/layout.mjs";

const directory = new URL("./", import.meta.url);
const byName = new Map(model.entities.map(entity => [entity.name, entity]));
assert.equal(byName.size, 11, "The simplified core ERD contains eleven entities");
assert.equal(new Set(model.entities.map(entity => entity.color.toLowerCase())).size, model.entities.length, "Every table needs a distinct color");
for (const entity of model.entities) {
  assert.equal(entity.fields.filter(field => field.key === "PK").length, 1);
  assert.equal(new Set(entity.fields.map(field => field.name)).size, entity.fields.length);
  assert.match(entity.color, /^#[0-9a-f]{6}$/i);
  const [x, y] = entity.position;
  assert.ok(x >= 0 && x + boxWidth <= model.width && y >= 0 && y + boxHeight(entity) <= model.height - 12);
  for (const field of entity.fields.filter(field => field.reference)) {
    const [name, key] = field.reference.split(".");
    const target = byName.get(name)?.fields.find(field => field.name === key);
    assert.equal(target?.key, "PK", `${entity.name}.${field.name}: invalid FK`);
    assert.equal(target.type, field.type);
    const links = model.relationships.filter(link => link.child === entity.name && link.field === field.name);
    assert.equal(links.length, 1);
    assert.equal(!!links[0].single, field.unique, `${entity.name}.${field.name}: one-to-one requires a unique FK`);
  }
}
const insideBorder = (point, entity) => {
  const [x, y] = entity.position, [px, py] = point, bottom = y + boxHeight(entity);
  return (px === x || px === x + boxWidth) && py >= y && py <= bottom || (py === y || py === bottom) && px >= x && px <= x + boxWidth;
};
for (const link of model.relationships) {
  const field = byName.get(link.child)?.fields.find(field => field.name === link.field);
  assert.equal(field?.reference?.split(".")[0], link.parent);
  assert.ok(insideBorder(link.points[0], byName.get(link.parent)), `Bad source port ${link.parent}/${link.child}`);
  assert.ok(insideBorder(link.points.at(-1), byName.get(link.child)), `Bad target port ${link.parent}/${link.child}`);
  for (let i = 1; i < link.points.length; i++) {
    const a = link.points[i - 1], b = link.points[i];
    assert.ok(a[0] === b[0] || a[1] === b[1], "Routes must be orthogonal");
    const obstacles = model.entities;
    for (const entity of obstacles) {
      const [x,y] = entity.position, right = x + (entity.width ?? boxWidth), bottom = y + (entity.height ?? boxHeight(entity));
      const intersects = a[0] === b[0] ? a[0] > x && a[0] < right && Math.max(a[1],b[1]) > y && Math.min(a[1],b[1]) < bottom : a[1] > y && a[1] < bottom && Math.max(a[0],b[0]) > x && Math.min(a[0],b[0]) < right;
      assert.ok(!intersects, `${link.parent}/${link.child} route passes through ${entity.name}`);
    }
  }
}
const reached = new Set([model.entities[0].name]);
validateGeometry({
  nodes: model.entities.map(entity => ({ id: entity.name, type: "entity", x: entity.position[0], y: entity.position[1], w: boxWidth, h: boxHeight(entity) })),
  edges: model.relationships.map(link => ({ from: link.parent, to: link.child, points: link.points })),
});
for (let i = 0; i < model.entities.length; i++) for (const link of model.relationships) {
  if (reached.has(link.parent) || reached.has(link.child)) { reached.add(link.parent); reached.add(link.child); }
}
assert.equal(reached.size, model.entities.length, "The figure must be connected");
assert.ok(byName.get("PURCHASE_ORDER").fields.some(field => field.name === "planned_date"));
assert.ok(byName.get("PURCHASE_ORDER").fields.some(field => field.name === "due_date"));
assert.equal(byName.get("INVENTORY_MOVEMENT").fields.find(field => field.name === "delivery_id").nullable, true);
assert.deepEqual(model.exclusiveParents, [{ entity: "DELIVERY", fields: ["po_id", "transfer_id"], mandatory: true }]);
for (const group of model.exclusiveParents) {
  for (const name of group.fields) assert.equal(byName.get(group.entity).fields.find(field => field.name === name)?.nullable, true);
  assert.ok(byName.get(group.entity).constraint.includes("XOR"));
}
const fontPoints = model.fontSize * model.printWidthMm / model.width * 72 / 25.4;
assert.ok(fontPoints >= 8, "Text must be at least eight points at the intended paper width");

const diagram = ["---", "config:", "  layout: elk", "  theme: neutral", "---", "erDiagram", "  direction TB", `  accTitle: ${model.title}`, "  accDescr: Eleven core entities with expanded business fields and unlabeled Crow's Foot connectors.", "  %% Proposed core business view, not the exhaustive physical database schema.", "  %% Publication SVG uses a distinct header color per entity; no legend or visible diagram title."];
for (const entity of model.entities) {
  diagram.push(`  %% ${entity.title} header color: ${entity.color}`);
  if(entity.constraint) diagram.push(`  %% ${entity.name} constraint: ${entity.constraint}; exactly one parent is required, never both or neither.`);
  diagram.push(`  ${entity.name}["${entity.title}"] {`);
  for (const field of entity.fields) diagram.push(`    ${field.type}${field.nullable ? "?" : ""} ${field.name}${field.key ? ` ${field.key}` : ""}${field.unique ? ' "unique"' : ""}`);
  diagram.push("  }");
}
for (const link of model.relationships) {
  const nullable = byName.get(link.child).fields.find(field => field.name === link.field).nullable;
  diagram.push(`  ${link.parent} ${nullable ? "|o" : "||"}..${link.single ? "o|" : "o{"} ${link.child} : ""`);
}
diagram.push("");

const rules = [
  "A Project contains MRFs and each MRF contains requested items. Scope-of-work budgets and shared material identities remain supporting detail outside this core business view; displayed names are not unique material keys.",
  "One MRF can receive several supplier quotations and produce multiple POs. Quotation lines, PO lines and allocations preserve split sourcing, source quantities, prices and unit conversions in the complete database; those entities are omitted from this figure.",
  "Unmatched supplier extras cannot be awarded until their match is reviewed and confirmed. Ordered quantities are reconciled in the requested stock unit.",
  "PO supplier identity is independent of the source quotation supplier, retaining Accounting vendor edits and original quotation provenance.",
  "Finance's current payment plan is summarized by PO priority and planned_date. Separate coordination records and history are omitted from this core view.",
  "Finance's planned_date is separate from Accounting's agreed credit due_date. Actual supplier payment happens outside the app; Accounting verifies it using archived proof. Scheduling never increases paid totals.",
  "Upfront requires full verified net payment before separate Accounting delivery clearance. Credit allows delivery while unpaid or partly paid, with several verified payments against the PO. Voided payments remain historical and do not count toward settlement.",
  "One MRF may have zero or many Stock Transfers, each connecting different source_id and destination_id projects. Its destination must match the MRF project. A transfer can have zero or many trips and does not reference a supplier PO or payment.",
  "A Delivery has exactly one parent: po_id XOR transfer_id. Both FKs are individually nullable, but neither both-set nor both-empty is valid. The visible XOR row is a constraint, not a stored attribute. This common business Delivery entity abstracts Batch and TransferDelivery without prescribing a migration.",
  "Supporting transfer lines link MRF items to source materials, proposed and released quantities; delivery lines record expected and accepted quantities. One item can combine several sites and supplier purchases. New comparisons use only the remaining purchase quantity, while old snapshots retain their basis.",
  "Source-assigned Site Personnel confirm release. Dispatch posts transfer-out at the source once; accepted destination quantities post transfer-in once. Reservations and explicit cancellation of undispatched allocations affect availability; shortages reopen demand without restoring dispatched stock. Original costs and budgets remain unchanged. Accounting reviews transfer receipts without invoices or payment proof.",
  "A PO or Stock Transfer can have several delivery trips. The delivery leg identifies supplier-to-site, supplier-to-warehouse, warehouse-to-site or site-to-site. Detailed delivery lines and warehouse source links are omitted, not replaced by one quantity for a whole delivery.",
  "Inventory movements identify the project and may reference a delivery batch. Usage, opening and adjustments may omit that reference. The complete database also identifies each material and delivery line; those structures are omitted here. Warehouse receipts do not create site stock. Enforce one posting per accepted site line; balances are derived from movements.",
];
const dictionary = ["# Core ERD: entity and relationship notes", "", "This proposed 11-entity core business view describes the intended production workflow with authenticated users and shared persistent records. It is not an exhaustive database schema or migration. See the [production design basis](../PRODUCTION_DESIGN.md).", "", "## Entities", "", "| Entity | Meaning |", "|---|---|", ...model.entities.map(entity => `| ${entity.title} | ${entity.purpose} |`), "", "## Cardinalities", "", "**1:N** means one-to-many (the parent may currently have zero children). **0..1:N** means a child may omit its parent, while that parent can be referenced by many children. The figure uses endpoint symbols only; the cardinality shorthand below is documentation, not a visible connector label. A crossing has no junction meaning; only endpoints attach records.", "", "| Parent | Child | Child FK | Label |", "|---|---|---|---|", ...model.relationships.map(link => `| ${byName.get(link.parent).title} | ${byName.get(link.child).title} | ${link.field}${link.single ? " (UNIQUE)" : ""} | ${cardinality(link)} |`), "", "## Workflow rules", "", ...rules.map(rule => `- ${rule}`), "", "## Supporting details omitted", "", "Document storage and proof associations, allocation drafts, bid comparisons, financial adjustments, reviewed tax settings, audit actors, revision snapshots and coordination history remain outside the figure. proof_reference summarizes archived evidence rather than limiting a payment to one attachment. Approval, payment, delivery clearance, stock posting and document completion are independent milestones. Draft field optionality and submission/finalization validation are not fully represented by the few displayed fields.", "", "Gross amount and net payable summarize reviewed PO financial amounts; detailed VAT, EWT and adjustments remain outside this core figure. Names, units and document references are business summaries, not substitutes for the supporting normalized structures. User has the seven current roles; Administrator is not a separate entity. Project assignments constrain source-site release and destination receipt/posting; their supporting user-project relationships are omitted from the core figure. No supplier portal is assumed. Stable material identity belongs to the supporting production model; displayed names alone do not identify stock. This does not introduce a new material-catalog management feature.", "", "## Sources", "", "- [Current workflow](../../WORKFLOW.md)", "- [Current domain records](../../../src/domain/types.ts)", "- [Domain glossary](../../../CONTEXT.md)", ""];
dictionary.splice(dictionary.indexOf("## Cardinalities"), 0,
  "## Shown fields and table colors", "",
  "| Entity | Displayed fields | Header color |", "|---|---|---|",
  ...model.entities.map(entity => `| ${entity.title} | ${entity.fields.map(field => field.name).join(", ")} | ${entity.color} |`), "");
const readme = `# ConstructSync core ERD

Version ${model.version} · ${model.verifiedDate} · **one figure, 11 entities**.

This simplified core ERD describes the intended production application as a proposed relational model. Supporting document, audit and history tables are omitted. Its design assumes authenticated users and shared persistent records; browser-local prototype storage is not its basis. See the [production design basis](../PRODUCTION_DESIGN.md).

## Use in the paper

Use [PDF](constructsync-erd.pdf) or [SVG](constructsync-erd.svg) for selectable vector text, or [PNG](constructsync-erd.png) for Word/Google Docs. Insert at **16 cm wide or larger**, without cropping; field text is ${fontPoints.toFixed(2)} pt at 16 cm. The figure measures 160 × ${(model.height / model.width * 160).toFixed(2)} mm. Increasing width to 18 cm makes text approximately ${(fontPoints * 18 / 16).toFixed(2)} pt. The single-page PDF uses the figure's actual physical size.

The figure contains only tables and unlabeled Crow's Foot connectors. Each table retains its distinct header color. The legend, numeric connector labels and diagram title are omitted. Related tables are grouped around the MRF and purchasing records, with transfers and stock below. Dedicated orthogonal routes have no crossings, shared segments or unrelated table intersections. The source and destination Project relationships use separate lanes. Add any paper caption separately.

## Read the relationships

- **1:N** — one-to-many; a parent can have zero or many children.
- **0..1:N** — a delivery has an optional PO relationship and optional transfer relationship, subject to the visible PO XOR transfer constraint. A movement may omit its delivery source.
- PK = primary key; FK = foreign key. Crow's Foot symbols preserve endpoint cardinalities. Dashed connectors represent non-identifying relationships.
- Follow each uninterrupted connector to its endpoints; the publication layout has no relationship crossings or shared segments. Each table has its own header color; colors identify tables and carry no cardinality meaning.

Stock Transfer identifies source and destination projects. Delivery has exactly one PO or transfer parent, marked by its XOR constraint. MRF Item keeps requested materials visible. Finance scheduling is summarized on the PO; Accounting records Verified Payment. The planned payment date is separate from the agreed due date. Detailed offered, ordered and delivered lines are omitted from the figure. [Entity and relationship notes](DATA_DICTIONARY.md) describe invariants and omitted supporting detail.

## Regenerate

[model.mjs](model.mjs) defines the entities, fields, cardinalities, colors and fixed publication positions. [Mermaid source](constructsync-erd.mmd) has identical fields and endpoint cardinalities; its automatic renderer may position boxes differently. The publication exporter uses fixed routes for print readability. [VALIDATION.md](VALIDATION.md) records checks.

\`\`\`powershell
node docs/thesis/erd/generate.mjs
node docs/thesis/erd/generate.mjs --check
node docs/thesis/erd/export.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"
\`\`\`

The exporter reuses Puppeteer from the installed Mermaid CLI package and Edge from puppeteer-config.json. The SVG creates the PNG and PDF. Application dependencies do not change.
`;
for (const [name, content] of new Map([["constructsync-erd.mmd", diagram.join("\n")], ["DATA_DICTIONARY.md", dictionary.join("\n")], ["README.md", readme]])) {
  if (process.argv.includes("--check")) assert.equal(await readFile(new URL(name, directory), "utf8"), content, `${name} is stale`);
  else await writeFile(new URL(name, directory), content, "utf8");
}
console.log(`${process.argv.includes("--check") ? "Verified" : "Generated"} one core ERD: ${model.entities.length} entities, ${model.relationships.length} unlabeled relationships, ${fontPoints.toFixed(2)} pt at 16 cm.`);
