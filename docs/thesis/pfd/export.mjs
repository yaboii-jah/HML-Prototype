import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { diagrams } from "./model.mjs";
import { validateGeometry } from "./layout.mjs";

const directory = fileURLToPath(new URL("./", import.meta.url));
const cliIndex = process.argv.indexOf("--cli");
assert.ok(cliIndex >= 0, "Pass --cli with the cached Mermaid CLI src/cli.js path");
const require = createRequire(path.resolve(process.argv[cliIndex + 1]));
const { default: puppeteer } = await import(pathToFileURL(require.resolve("puppeteer")).href);
const generated = spawnSync(process.execPath, [path.join(directory, "generate.mjs")], { encoding: "utf8", windowsHide: true });
assert.equal(generated.status, 0, generated.stderr);
process.stdout.write(generated.stdout);
const configuration = JSON.parse(await readFile(new URL("../erd/puppeteer-config.json", import.meta.url), "utf8"));
const temporary = await mkdtemp(path.join(os.tmpdir(), "constructsync-pfd-"));
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const textWidth = (value, size) => [...value].reduce((sum, character) => sum + ("ilI1.,| /".includes(character) ? 0.27 : /[A-Z]/.test(character) ? 0.65 : 0.52) * size, 0);
const wrap = (values, width, size) => [values].flat().flatMap(value => {
  const lines = []; let line = "";
  for (const word of value.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size) > width) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
});

function render(diagram) {
  const dimensions = diagram.page;
  const font = dimensions.fontSize, step = font * 1.12;
  const block = (lines, cx, cy, roles = 0) => lines.map((line, index) => `<text x="${cx}" y="${cy - (lines.length - 1) * step / 2 + index * step + font * 0.35}" text-anchor="middle"${index < roles ? ' font-weight="bold"' : ""}>${escape(line)}</text>`).join("");
  const nodes = diagram.nodes.map(node => {
    const role = node.role ? wrap(node.role, node.type === "decision" ? node.w * 0.75 : node.w - 28, font) : [];
    const lines = [...role, ...wrap(node.lines, node.type === "decision" ? node.w * 0.75 : node.w - 28, font)];
    const shape = node.type === "connector" ? `<circle cx="${node.w/2}" cy="${node.h/2}" r="${node.w/2}"/>` : node.type === "decision" ? `<polygon points="${node.w/2},0 ${node.w},${node.h/2} ${node.w/2},${node.h} 0,${node.h/2}"/>` : node.type === "reference" ? `<polygon points="0,0 ${node.w},0 ${node.w},${node.h*0.8} ${node.w/2},${node.h} 0,${node.h*0.8}"/>` : `<rect width="${node.w}" height="${node.h}" rx="${node.type === "terminal" ? node.h/2 : 0}"/>`;
    const sides = node.type === "subprocess" ? `<path d="M12 0V${node.h}M${node.w-12} 0V${node.h}"/>` : "";
    return `<g data-node="${node.id}" data-kind="${node.type}" transform="translate(${node.x},${node.y})"><title>${escape(node.name || [...(node.role ? [node.role].flat() : []), ...node.lines].join("; "))}</title><g fill="white" stroke="#000000" stroke-width="1.8">${shape}${sides}</g>${block(lines, node.w/2, node.h*(node.type === "reference" ? 0.4 : 0.5), role.length)}</g>`;
  }).join("");
  const edges = diagram.edges.map((edge, index) => `<g data-edge="${index}" data-from="${edge.from}" data-to="${edge.to}"><title>${escape(edge.label || `${edge.from} to ${edge.to}`)}</title><polyline points="${edge.points.map(point => point.join(",")).join(" ")}" stroke="#000000" stroke-width="1.8" stroke-linejoin="round" fill="none" marker-end="url(#arrow)"/></g>`).join("");
  const labels = diagram.edges.flatMap((edge, index) => {
    if (!edge.label) return [];
    const [cx, cy, width] = edge.labelAt, lines = wrap(edge.label, width, font), height = lines.length * step + 6;
    return [`<g data-label="${index}"><rect x="${cx-width/2-3}" y="${cy-height/2}" width="${width+6}" height="${height}" rx="2" fill="white"/>${block(lines,cx,cy)}</g>`];
  }).join("");
  const height = dimensions.height/dimensions.width*dimensions.printWidthMm;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimensions.width} ${dimensions.height}" width="${dimensions.printWidthMm}mm" height="${height}mm" role="img" aria-labelledby="accessible-title" style="font-family:Arial,sans-serif;font-size:${font}px;fill:#000000"><title id="accessible-title">ConstructSync Process Flow: ${escape(diagram.name)}</title><desc>Role-labeled business process flow. Credit payment and delivery are independent. End symbols indicate distinct milestones rather than automatic MRF closure.</desc><defs><marker id="arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L8 4L0 8Z" fill="#000000"/></marker></defs><rect width="100%" height="100%" fill="white"/>${edges}${nodes}${labels}</svg>`;
}

const browser = await puppeteer.launch(configuration);
const reports = [];
try {
  for (const diagram of diagrams) {
    const dimensions = diagram.page;
    validateGeometry(diagram);
    const prefix = `constructsync-${diagram.id}`, svg = render(diagram);
    const page = await browser.newPage();
    await page.setViewport({ width: dimensions.width, height: dimensions.height, deviceScaleFactor: 4 });
    await page.setContent(`<html><head><style>html,body{margin:0}body>svg{display:block;width:${dimensions.width}px;height:${dimensions.height}px}</style></head><body>${svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const errors = [], canvas = document.querySelector("svg").getBoundingClientRect();
      const nodes = [...document.querySelectorAll("[data-node]")], labels = [...document.querySelectorAll("[data-label]")];
      const overlaps = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      for (const node of nodes) {
        const bounds = node.querySelector("rect,polygon,circle").getBoundingClientRect();
        for (const text of node.querySelectorAll("text")) {
          const rect = text.getBoundingClientRect();
          if (rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom) errors.push(`Text clips ${node.dataset.node}: ${text.textContent}`);
          if (node.dataset.kind === "decision") {
            const cx = (bounds.left+bounds.right)/2, cy = (bounds.top+bounds.bottom)/2;
            for (const x of [rect.left,rect.right]) for (const y of [rect.top,rect.bottom]) if (Math.abs(x-cx)/(bounds.width/2)+Math.abs(y-cy)/(bounds.height/2)>1.025) errors.push(`Text outside diamond ${node.dataset.node}: ${text.textContent}`);
          }
        }
      }
      for (const label of labels) {
        const rect = label.getBoundingClientRect();
        if (rect.left < canvas.left || rect.right > canvas.right || rect.top < canvas.top || rect.bottom > canvas.bottom) errors.push(`Label outside canvas ${label.dataset.label}`);
        for (const node of nodes) if (overlaps(rect,node.getBoundingClientRect())) errors.push(`Label ${label.dataset.label} overlaps ${node.dataset.node}`);
      }
      for (let i = 0; i < labels.length; i++) for (let j = i+1; j < labels.length; j++) if (overlaps(labels[i].getBoundingClientRect(),labels[j].getBoundingClientRect())) errors.push(`Labels overlap ${labels[i].dataset.label}/${labels[j].dataset.label}`);
      return { errors, labelBounds: labels.map(label => {
        const box = label.getBBox();
        return { id: label.dataset.label, x: box.x, y: box.y, w: box.width, h: box.height };
      }) };
    });
    assert.deepEqual(result.errors, [], `${diagram.id}: layout errors`);
    const geometry = validateGeometry(diagram,result.labelBounds);
    await writeFile(path.join(directory, `${prefix}.svg`), svg, "utf8");
    await page.screenshot({ path: path.join(directory, `${prefix}.png`), fullPage: true });
    await page.setViewport({ width: dimensions.width, height: dimensions.height, deviceScaleFactor: 1 });
    const preview = path.join(temporary, `${diagram.id}-preview.png`);
    await page.screenshot({ path: preview, fullPage: true });
    await page.setContent(`<html><head><style>@page{size:A4 ${dimensions.orientation};margin:10mm}html,body{margin:0}body{width:${dimensions.orientation === "portrait" ? 190 : 277}mm;height:${dimensions.orientation === "portrait" ? 277 : 190}mm;display:flex;align-items:center;justify-content:center}svg{display:block;width:${dimensions.printWidthMm}mm;height:auto;max-height:${dimensions.orientation === "portrait" ? 277 : 190}mm}</style></head><body>${svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    assert.equal(pdf.getPageCount(), 1, "Each diagram must fit one page");
    assert.ok(Math.abs(pdf.getPage(0).getWidth()-(dimensions.orientation === "portrait" ? 210 : 297)*72/25.4) < 1);
    assert.ok(Math.abs(pdf.getPage(0).getHeight()-(dimensions.orientation === "portrait" ? 297 : 210)*72/25.4) < 1);
    pdf.setTitle(`ConstructSync Process Flow: ${diagram.name}`);
    pdf.setSubject("Role responsibilities and descriptive process handoffs in the purchasing, payment and delivery workflow");
    const bytes = await pdf.save(), loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    try {
      const parsed = await loading.promise, content = await (await parsed.getPage(1)).getTextContent();
      const text = content.items.map(item => item.str).join(" ").replace(/\s+/g," ");
      for (const node of diagram.nodes) for (const label of [...(node.role ? [node.role].flat() : []), ...node.lines]) assert.ok(text.includes(label.replace(/\s+/g," ")), `Missing PDF text: ${node.id}/${label}`);
      for (const edge of diagram.edges) if (edge.label) assert.ok(text.includes(edge.label), `Missing PDF decision label: ${edge.label}`);
      const sizes = content.items.filter(item => item.str.trim()).map(item => Math.hypot(item.transform[0],item.transform[1]));
      assert.ok(Math.min(...sizes) >= dimensions.minimumPoints, "Actual PDF text must be at least 10 pt");
    } finally { await loading.destroy(); }
    await writeFile(path.join(directory, `${prefix}.pdf`), bytes);
    const points = dimensions.fontSize*dimensions.printWidthMm/dimensions.width*72/25.4;
    reports.push(`- **${diagram.name}**: ${diagram.nodes.length} symbols, ${diagram.edges.length} connections. One A4 ${dimensions.orientation} PDF, selectable text of at least ${points.toFixed(2)} pt; PNG ${dimensions.width*4} × ${dimensions.height*4} pixels. ${geometry.crossings} connector crossings, ${geometry.overlappingSegments} overlapping segments and ${geometry.labelCollisions} connector/label collisions.`);
    console.log(`${diagram.id} exported. Preview: ${preview}`);
    await page.close();
  }
} finally { await browser.close(); }

await writeFile(path.join(directory,"VALIDATION.md"), `# Process flow validation

Checked against docs/WORKFLOW.md and the delivery/payment rules on ${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}.

${reports.join("\n")}

- The request and fulfillment overview supports purchase-only, transfer-only and mixed MRF quantities. Existing project setup is a prerequisite. Issued supplier POs proceed to payment coordination.
- Site transfers require Procurement's matching-description/unit verification and availability check, followed directly by source release and dispatch before destination receiving; transfers have no destination suitability-review or PO/payment path.
- Reduced/rejected release quantities and missing transfer quantities return to material sourcing without reversing source dispatch; accepted site quantities still reach stock posting independently.
- Warehouse and site receipt evidence each proceeds to documentation and review. Warehouse documentation does not wait for site arrival, and receipt review never gates site stock posting.
- All nodes are reachable, decisions have labeled outcomes, and approval returns/rejections/holds retain their meaning.
- Upfront delivery cannot bypass full verified payment. A failed payment/proof check loops for resolution.
- Credit clearance reaches supplier delivery without entering the payment path. Payment settlement is reachable without entering delivery/document activities. Partial payment loops to Finance follow-up and never retriggers clearance.
- Direct site receipt and warehouse receipt/transfer/site receipt are both reachable.
- Site inventory and document review finish independently; neither closes the MRF. Warehouse receipt does not post site inventory. Receipt review loops incomplete or unacceptable evidence for correction and re-archiving.
- Entries and handoffs name business events and processes. Visible node/arrow labels and active explanations are checked to reject figure-letter references and the former abbreviated credit connector.
- Connectors are orthogonal and continuous, start/end on separate symbol ports and do not touch unrelated shapes. Geometry checks reject connector crossings, shared segments and self-intersections. The Credit connector routes independent credit paths; off-page handoffs name their next process.
- Actual rendered label bounds are checked against every connector, including their own, with 2 px clearance. Label backgrounds cannot hide lines. No white under-strokes erase connector intersections. Layout checks also reject clipped text, overlapping labels, labels covering shapes, and text outside decision diamonds.
- Each active PDF is one A4 page in its documented orientation with selectable node/branch text and actual text of at least 10 pt. The SVG preserves vector text; the PNG renders at 4× resolution.
- Run node docs/thesis/pfd/generate.mjs --check to check model and editable-source consistency.

These are documentation/export checks. No application or database changes were made.
`, "utf8");
