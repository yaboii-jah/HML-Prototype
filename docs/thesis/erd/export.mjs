import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { model, boxWidth, headerHeight, rowHeight, boxHeight, cardinality } from "./model.mjs";

const directory = fileURLToPath(new URL("./", import.meta.url));
const cliIndex = process.argv.indexOf("--cli");
const cli = cliIndex >= 0 ? process.argv[cliIndex + 1] : (process.env.PATH || "").split(path.delimiter).map(entry => path.resolve(entry, "..", "@mermaid-js", "mermaid-cli", "src", "cli.js")).find(existsSync);
assert.ok(cli && existsSync(cli), "Pass --cli with the cached Mermaid CLI src/cli.js path to reuse Puppeteer");
const generated = spawnSync(process.execPath, [path.join(directory, "generate.mjs")], { encoding: "utf8", windowsHide: true });
assert.equal(generated.status, 0, generated.stderr || generated.error?.message);
process.stdout.write(generated.stdout);
const byName = new Map(model.entities.map(entity => [entity.name, entity]));
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

// Symbols are placed along the inward direction from each endpoint.
const symbol = (point, neighbor, kind) => {
  const dx = neighbor[0] - point[0], dy = neighbor[1] - point[1];
  const distance = Math.hypot(dx, dy), ux = dx / distance, uy = dy / distance;
  const at = (along, across = 0) => [point[0] + ux * along - uy * across, point[1] + uy * along + ux * across];
  const line = (a, b) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
  const circle = along => { const p = at(along); return `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="white"/>`; };
  if (kind === "many") return line(at(0, -5), at(9)) + line(at(0, 5), at(9)) + circle(15);
  if (kind === "optionalChild") return line(at(5, -5), at(5, 5)) + circle(15);
  return line(at(5, -5), at(5, 5)) + (kind === "optionalOne" ? circle(13) : line(at(9, -5), at(9, 5)));
};
const links = model.relationships.map(link => {
  const optional = byName.get(link.child).fields.find(field => field.name === link.field).nullable;
  const points = link.points.map(point => point.join(",")).join(" ");
  return `<g data-relationship="${link.parent}:${link.child}:${link.field}" stroke="#596675" stroke-width="1.2" fill="none"><title>${escape(link.parent)} ${escape(link.label)} ${escape(link.child)}: ${cardinality(link)}</title><polyline points="${points}" stroke="white" stroke-width="5"/><polyline points="${points}" stroke-dasharray="5 4"/>${symbol(link.points[0], link.points[1], optional ? "optionalOne" : "one")}${symbol(link.points.at(-1), link.points.at(-2), link.single ? "optionalChild" : "many")}</g>`;
}).join("\n");
const boxes = model.entities.map(entity => {
  const [x, y] = entity.position, height = boxHeight(entity), color = entity.color;
  return `<g data-entity="${entity.name}" transform="translate(${x},${y})"><title>${escape(entity.purpose)}</title><rect width="${boxWidth}" height="${height}" rx="3" fill="white" stroke="#53606e" stroke-width="0.9"/><path data-header="true" d="M3 0H${boxWidth - 3}Q${boxWidth} 0 ${boxWidth} 3V${headerHeight}H0V3Q0 0 3 0Z" fill="${color}"/><line x1="0" y1="${headerHeight}" x2="${boxWidth}" y2="${headerHeight}" stroke="#53606e" stroke-width="0.65"/><line x1="42" y1="${headerHeight}" x2="42" y2="${height}" stroke="#bac2ca" stroke-width="0.65"/><text class="entity-title" x="${boxWidth / 2}" y="${headerHeight * 0.66}" text-anchor="middle" font-size="${model.headerFontSize}" font-weight="bold">${escape(entity.title)}</text>${entity.fields.map((field, index) => `<g data-field="${field.name}"><text x="6" y="${headerHeight + index * rowHeight + rowHeight * 0.72}" font-weight="${field.key ? "bold" : "normal"}">${escape(field.key)}</text><text x="50" y="${headerHeight + index * rowHeight + rowHeight * 0.72}">${escape(field.name)}</text></g>`).join("")}${entity.constraint ? `<line x1="0" y1="${headerHeight+entity.fields.length*rowHeight}" x2="${boxWidth}" y2="${headerHeight+entity.fields.length*rowHeight}" stroke="#53606e"/><text data-constraint="true" x="${boxWidth/2}" y="${height-rowHeight*0.28}" text-anchor="middle" font-weight="bold">${escape(entity.constraint)}</text>` : ""}</g>`;
}).join("\n");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${model.printWidthMm}mm" height="${model.height / model.width * model.printWidthMm}mm" viewBox="0 0 ${model.width} ${model.height}" role="img" aria-labelledby="figure-title" style="font-family:Arial,sans-serif;font-size:${model.fontSize}px;fill:#182534"><title id="figure-title">${escape(model.title)}</title><desc>Eleven core entities with business fields, unlabeled Crow's Foot relationships and distinct header colors.</desc><rect width="100%" height="100%" fill="white"/>${links}${boxes}</svg>`;
await writeFile(path.join(directory, "constructsync-erd.svg"), svg, "utf8");
const require = createRequire(path.resolve(cli));
const { default: puppeteer } = await import(pathToFileURL(require.resolve("puppeteer")).href);
const configuration = JSON.parse(await readFile(path.join(directory, "puppeteer-config.json"), "utf8"));
const temporary = await mkdtemp(path.join(os.tmpdir(), "constructsync-core-erd-"));
const browser = await puppeteer.launch(configuration);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: model.width, height: model.height, deviceScaleFactor: 4 });
  await page.setContent(`<html><head><style>html,body{margin:0}body>svg{display:block;width:${model.width}px;height:${model.height}px}</style></head><body>${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(expected => {
    const errors = [], nodes = [...document.querySelectorAll("[data-entity]")], texts = [...document.querySelectorAll("svg text")];
    for (const entity of expected) {
      const node = nodes.find(node => node.dataset.entity === entity.name);
      if (!node) { errors.push(`Missing ${entity.name}`); continue; }
      const bounds = node.querySelector("rect").getBoundingClientRect();
      if (node.querySelector("[data-header]")?.getAttribute("fill") !== entity.color) errors.push(`Wrong header color: ${entity.name}`);
      for (const field of entity.fields) if (!node.querySelector(`[data-field="${field.name}"]`)) errors.push(`Missing ${entity.name}.${field.name}`);
      for (const field of node.querySelectorAll("[data-field]")) {
        const [key, name] = [...field.querySelectorAll("text")].map(text => text.getBoundingClientRect());
        if (key.right > name.left) errors.push(`Key overlaps field name: ${entity.name}/${field.dataset.field}`);
      }
      for (const text of node.querySelectorAll("text")) {
        const rect = text.getBoundingClientRect();
        if (rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom) errors.push(`Text clipped: ${entity.name}/${text.textContent}`);
      }
    }
    const canvas = document.querySelector("svg").getBoundingClientRect();
    for (const text of texts) {
      if (!text.closest("[data-entity]")) errors.push("Unexpected visible text outside tables");
      if (/\b(?:1:N|0\.\.1:N|1:0\.\.1)\b/.test(text.textContent)) errors.push("Numeric relationship label remains visible");
      const rect = text.getBoundingClientRect();
      if (rect.left < canvas.left || rect.right > canvas.right || rect.top < canvas.top || rect.bottom > canvas.bottom) errors.push(`Canvas clips: ${text.textContent}`);
    }
    const overlaps = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      if (overlaps(nodes[i].getBoundingClientRect(),nodes[j].getBoundingClientRect())) errors.push(`Tables overlap: ${nodes[i].dataset.entity}/${nodes[j].dataset.entity}`);
    }
    return { errors, nodes: nodes.length, links: document.querySelectorAll("[data-relationship]").length, captions: document.querySelectorAll("[data-cardinality]").length, legendEntries: document.querySelectorAll("[data-color-legend]").length, minimumFont: Math.min(...texts.map(text => parseFloat(getComputedStyle(text).fontSize))) };
  }, model.entities);
  assert.deepEqual(result.errors, []);
  assert.equal(result.nodes, model.entities.length);
  assert.equal(result.links, model.relationships.length);
  assert.equal(result.captions, 0);
  assert.equal(result.legendEntries, 0);
  const minimumPoints = result.minimumFont * model.printWidthMm / model.width * 72 / 25.4;
  assert.ok(minimumPoints >= 8, "Every visible label must be at least 8 pt at 16 cm");
  await page.screenshot({ path: path.join(directory, "constructsync-erd.png"), fullPage: true });
  await page.setViewport({ width: model.width, height: model.height, deviceScaleFactor: 1 });
  const preview = path.join(temporary, "actual-width-preview.png");
  await page.screenshot({ path: preview, fullPage: true });

  const heightMm = model.height / model.width * model.printWidthMm;
  await page.setContent(`<html><head><style>@page{size:${model.printWidthMm}mm ${heightMm}mm;margin:0}html,body{margin:0}body>svg{display:block;width:${model.printWidthMm}mm;height:${heightMm}mm}</style></head><body>${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  assert.equal(pdf.getPageCount(), 1);
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - model.printWidthMm * 72 / 25.4) < 1);
  pdf.setTitle(model.title);
  pdf.setSubject("Single core business ERD for the ConstructSync research paper");
  pdf.setCreator("ConstructSync vector ERD exporter");
  const bytes = await pdf.save();
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const parsed = await loading.promise;
    const text = await (await parsed.getPage(1)).getTextContent();
    for (const entity of model.entities) {
      assert.ok(text.items.some(item => item.str === entity.title), `${entity.title} must be selectable in the PDF`);
      for (const field of entity.fields) assert.ok(text.items.some(item => item.str === field.name), `${entity.name}.${field.name} must be selectable in the PDF`);
    }
  } finally { await loading.destroy(); }
  await writeFile(path.join(directory, "constructsync-erd.pdf"), bytes);
  await writeFile(path.join(directory, "VALIDATION.md"), `# Core ERD validation

Verified on ${model.verifiedDate}.

- Exactly ${model.entities.length} connected entities, ${model.entities.reduce((sum,entity) => sum + entity.fields.length,0)} business fields and ${model.relationships.length} unlabeled Crow's Foot relationships.
- Unique entity/field names, one PK per entity and valid type-matched FK targets.
- All connector endpoints terminate on their entity borders; orthogonal routes do not pass through boxes.
- All sixteen relationship routes have zero crossings, overlapping segments or accidental junctions. Source and destination Project links use separate lanes; every cardinality endpoint remains visible.
- No numeric relationship labels appear. Endpoint symbols retain cardinalities.
- Eleven distinct header colors are retained; no legend is present and tables do not overlap.
- Visible text is limited to table names, fields, keys and the Delivery XOR constraint. No legend, numeric connector labels, diagram title or explanatory caption is present.
- All displayed fields and headers fit their boxes and canvas.
- Every label is at least ${minimumPoints.toFixed(2)} pt at the intended 160 mm width.
- SVG is 160 × ${heightMm.toFixed(2)} mm, preserving scalable text and colored headers.
- PNG is ${model.width * 4} × ${model.height * 4} pixels, generated from that SVG.
- PDF is exactly one figure-sized page, approximately 160 × ${heightMm.toFixed(2)} mm; every entity title and field is selectable text.
- Mermaid and publication outputs use the same entity and relationship definitions; Mermaid's automatic positions differ from the fixed paper layout.

## Scenario review

These checks concern the reduced model, not an installed database or runtime changes.

| Scenario | Representation |
|---|---|
| Internal transfer or mixed fulfillment | Stock Transfer links one MRF to source/destination projects; material-level quantities remain in supporting lines. |
| Independent delivery source | Delivery requires exactly one PO or transfer parent, explicitly marked XOR; trips need no fictional PO. |
| Source release and site balances | Source confirmation, transfer-out at dispatch and transfer-in for accepted destination stock are retained in notes. |
| Several suppliers and split sourcing | Multiple quotations and POs per MRF; detailed line allocations are explained outside the figure. |
| Unmatched offered extras | Detailed matches are omitted; notes preserve the confirmed-match requirement before award. |
| Partial credit payments | One PO can have zero or many Accounting-verified payments; delivery need not wait for settlement. |
| Upfront payment | Full verified net payment remains required before separate Accounting delivery clearance. |
| Finance schedule versus Accounting due date | PO planned_date and due_date remain separate; current coordination is summarized on the PO. |
| Vendor edited during Accounting review | PO has its own supplier FK and separately retains its source quotation. |
| Partial deliveries and warehouse forwarding | A PO has multiple deliveries distinguished by leg; source/line structures are omitted from the core figure. |
| Site receipts, usage and adjustments | Delivery is optional for inventory movements; project is required and balances are derived. |
| Scope budgets and shared material identities | Supporting structures are documented outside the figure. |
| Required proof and other documents | Essential proof reference is visible; document storage and multiple associations remain documented supporting detail. |

## Recheck

Run node docs/thesis/erd/generate.mjs --check for canonical source consistency. The exporter additionally checks actual rendered labels, print size, PDF page count and selectable fields.
`, "utf8");
  console.log(`Exported one 11-entity diagram with expanded fields, eleven table colors and a compact layout without a legend. Preview: ${preview}`);
} finally { await browser.close(); }
