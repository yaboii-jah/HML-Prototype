import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { page, boxWidth, boxHeight, headerHeight, rowHeight, padding, classes, associations, constraint, mermaidSource, validateModel } from "./model.mjs";

const report = validateModel(), directory = fileURLToPath(new URL("./", import.meta.url));
const cliIndex = process.argv.indexOf("--cli");
assert.ok(cliIndex >= 0 && process.argv[cliIndex + 1], "Pass --cli with the cached Mermaid CLI src/cli.js path");
const cli = path.resolve(process.argv[cliIndex + 1]);
const require = createRequire(cli);
const { default: puppeteer } = await import(pathToFileURL(require.resolve("puppeteer")).href);
const configurationPath = fileURLToPath(new URL("../erd/puppeteer-config.json", import.meta.url));
const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
const temporary = await mkdtemp(path.join(os.tmpdir(), "constructsync-uml-"));
await writeFile(path.join(directory, "constructsync-class-diagram.mmd"), mermaidSource(), "utf8");

const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function endpointLabel(point, neighbor, text, override) {
  const dx = neighbor[0] - point[0], dy = neighbor[1] - point[1];
  const [x,y,anchor] = override || (dx !== 0 ? [point[0] + Math.sign(dx)*14, point[1]-12, dx > 0 ? "start" : "end"] : [point[0]+16, point[1]+(dy > 0 ? 25 : -12), "start"]);
  return `<text data-multiplicity="true" x="${x}" y="${y}" text-anchor="${anchor}" font-size="${page.labelSize}">${escape(text)}</text>`;
}
const connectors = associations.map((link,index) => {
  let diamond = "";
  if (link.composition) {
    const [point, neighbor] = link.points;
    const dx = neighbor[0]-point[0], dy = neighbor[1]-point[1], distance = Math.hypot(dx,dy), ux=dx/distance, uy=dy/distance;
    const at = (along, across=0) => [point[0]+ux*along-uy*across, point[1]+uy*along+ux*across].join(",");
    diamond = `<polygon data-composition="true" points="${[at(0),at(11,6),at(22),at(11,-6)].join(" ")}" fill="#243343"/>`;
  }
  const role = link.labelAt ? `<text data-association-role="true" x="${link.labelAt[0]}" y="${link.labelAt[1]}" text-anchor="${link.labelAt[2]}" font-size="${page.labelSize}">${escape(link.role)}</text>` : "";
  return `<g data-association="${index}" data-from="${link.from}" data-to="${link.to}"><title>${escape(link.from)} ${link.a} — ${link.b} ${escape(link.to)}${link.role ? ` (${escape(link.role)})` : ""}</title><polyline points="${link.points.map(point => point.join(",")).join(" ")}" fill="none" stroke="#243343" stroke-width="1.6" stroke-linejoin="round"/>${diamond}${endpointLabel(link.points[0],link.points[1],link.a)}${endpointLabel(link.points.at(-1),link.points.at(-2),link.b,link.endLabelAt)}${role}</g>`;
}).join("\n");
const boxes = classes.map(item => {
  const divider = headerHeight + padding + item.attributes.length*rowHeight;
  const memberText = (values,offset,kind) => values.map((value,index) => `<text data-${kind}="${escape(value)}" x="16" y="${offset + padding/2 + index*rowHeight + page.fontSize}">${escape(value)}</text>`).join("");
  return `<g data-class="${item.name}" transform="translate(${item.position.join(",")})"><title>${escape(item.meaning)}</title><rect width="${boxWidth}" height="${boxHeight(item)}" fill="white" stroke="#243343" stroke-width="1.6"/><rect data-header="true" width="${boxWidth}" height="${headerHeight}" fill="${item.color}"/><path d="M0 ${headerHeight}H${boxWidth}M0 ${divider}H${boxWidth}" stroke="#243343" stroke-width="1.2"/><text data-class-title="true" x="${boxWidth/2}" y="29" text-anchor="middle" font-size="24" font-weight="bold">${item.name}</text>${memberText(item.attributes,headerHeight,"attribute")}${memberText(item.operations,divider,"operation")}</g>`;
}).join("\n");
const note = `<g data-constraint="true"><polyline points="${constraint.leader.map(point => point.join(",")).join(" ")}" fill="none" stroke="#243343" stroke-width="1.2" stroke-dasharray="5 4"/><path data-note-box="true" d="M${constraint.x} ${constraint.y}H${constraint.x+constraint.w-18}L${constraint.x+constraint.w} ${constraint.y+18}V${constraint.y+constraint.h}H${constraint.x}Z" fill="#f8fafc" stroke="#243343" stroke-width="1.2"/><path d="M${constraint.x+constraint.w-18} ${constraint.y}V${constraint.y+18}H${constraint.x+constraint.w}" fill="none" stroke="#243343" stroke-width="1.2"/>${constraint.lines.map((line,index) => `<text x="${constraint.x+16}" y="${constraint.y+30+index*29}" font-size="${page.fontSize}"${index===0 ? ' font-weight="bold"' : ""}>${escape(line)}</text>`).join("")}</g>`;
const heightMm = page.height/page.width*page.printWidthMm;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${page.width} ${page.height}" width="${page.printWidthMm}mm" height="${heightMm}mm" role="img" aria-labelledby="diagram-title" style="font-family:Arial,sans-serif;font-size:${page.fontSize}px;fill:#172534"><title id="diagram-title">ConstructSync Core UML Class Diagram</title><desc>Eleven domain classes with essential attributes, conceptual business operations, seventeen associations with multiplicities, MRF-item composition, and exactly one Delivery owner.</desc><rect width="100%" height="100%" fill="white"/>${connectors}${boxes}${note}</svg>`;

const browser = await puppeteer.launch(configuration);
try {
  const tab = await browser.newPage();
  await tab.setViewport({ width: page.width, height: page.height, deviceScaleFactor: 3 });
  await tab.setContent(`<html><head><style>html,body{margin:0}body>svg{display:block;width:${page.width}px;height:${page.height}px}</style></head><body>${svg}</body></html>`);
  await tab.evaluate(() => document.fonts.ready);
  const geometry = await tab.evaluate(() => {
    const errors = [], canvas = document.querySelector("svg").getBoundingClientRect();
    const boxes = [...document.querySelectorAll("[data-class]")];
    const intersects = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const bounds = box => box.querySelector("rect").getBoundingClientRect();
    for (const box of boxes) for (const text of box.querySelectorAll("text")) {
      const a = text.getBoundingClientRect(), b = bounds(box);
      if (a.left < b.left || a.right > b.right || a.top < b.top || a.bottom > b.bottom) errors.push(`Clipped class text: ${box.dataset.class}/${text.textContent}`);
    }
    for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) if (intersects(bounds(boxes[i]),bounds(boxes[j]))) errors.push("Classes overlap");
    const outside = [...document.querySelectorAll("text")].filter(text => !text.closest("[data-class]"));
    for (const text of document.querySelectorAll("text")) {
      const a = text.getBoundingClientRect();
      if (a.left < canvas.left || a.right > canvas.right || a.top < canvas.top || a.bottom > canvas.bottom) errors.push(`Canvas clips: ${text.textContent}`);
    }
    for (const text of outside) for (const box of boxes) if (intersects(text.getBoundingClientRect(),bounds(box))) errors.push(`Label overlaps class: ${text.textContent}/${box.dataset.class}`);
    for (let i=0;i<outside.length;i++) for (let j=i+1;j<outside.length;j++) if (intersects(outside[i].getBoundingClientRect(),outside[j].getBoundingClientRect())) errors.push(`Labels overlap: ${outside[i].textContent}/${outside[j].textContent}`);
    for (const text of outside.filter(text => text.closest("[data-association]"))) {
      const box = text.getBBox();
      for (const line of document.querySelectorAll("[data-association] polyline")) {
        const points = [...line.points];
        for (let i=1;i<points.length;i++) {
          const a=points[i-1], b=points[i];
          const hit = a.x===b.x ? a.x>box.x && a.x<box.x+box.width && Math.max(a.y,b.y)>box.y && Math.min(a.y,b.y)<box.y+box.height : a.y>box.y && a.y<box.y+box.height && Math.max(a.x,b.x)>box.x && Math.min(a.x,b.x)<box.x+box.width;
          if (hit) errors.push(`Connector intersects text: ${text.textContent}`);
        }
      }
    }
    const note = document.querySelector("[data-note-box]").getBoundingClientRect();
    for (const text of document.querySelectorAll("[data-constraint] text")) {
      const a = text.getBoundingClientRect();
      if (a.left<note.left || a.right>note.right || a.top<note.top || a.bottom>note.bottom) errors.push("Constraint text clipped");
    }
    return { errors, classCount: boxes.length, attributes: document.querySelectorAll("[data-attribute]").length, operations: document.querySelectorAll("[data-operation]").length, associations: document.querySelectorAll("[data-association]").length, multiplicities: document.querySelectorAll("[data-multiplicity]").length, composition: document.querySelectorAll("[data-composition]").length, minFont: Math.min(...[...document.querySelectorAll("text")].map(text => parseFloat(getComputedStyle(text).fontSize))) };
  });
  assert.deepEqual(geometry.errors, []);
  assert.equal(geometry.classCount, report.classes);
  assert.equal(geometry.attributes, report.attributes);
  assert.equal(geometry.operations, report.operations);
  assert.equal(geometry.associations, report.associations);
  assert.equal(geometry.multiplicities, report.associations*2);
  assert.equal(geometry.composition, 1);
  const minimumPoints = geometry.minFont*page.printWidthMm/page.width*72/25.4;
  assert.ok(minimumPoints >= 8, "Every label should be at least 8 pt at the intended insertion width");
  await writeFile(path.join(directory, "constructsync-class-diagram.svg"), svg, "utf8");
  await tab.screenshot({ path: path.join(directory, "constructsync-class-diagram.png"), fullPage: true });
  await tab.setViewport({ width: page.width, height: page.height, deviceScaleFactor: 1 });
  const preview = path.join(temporary, "preview.png");
  await tab.screenshot({ path: preview, fullPage: true });
  await tab.setContent(`<html><head><style>@page{size:${page.printWidthMm}mm ${heightMm}mm;margin:0}html,body{margin:0}body>svg{display:block;width:${page.printWidthMm}mm;height:${heightMm}mm}</style></head><body>${svg}</body></html>`);
  await tab.evaluate(() => document.fonts.ready);
  const pdf = await PDFDocument.load(await tab.pdf({ preferCSSPageSize: true, printBackground: true }));
  assert.equal(pdf.getPageCount(), 1);
  pdf.setTitle("ConstructSync Core UML Class Diagram");
  pdf.setSubject("Eleven-class thesis domain model with conceptual operations");
  const bytes = await pdf.save();
  const parsed = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const document = await parsed.promise, content = await (await document.getPage(1)).getTextContent();
    const strings = new Set(content.items.map(item => item.str));
    for (const item of classes) for (const text of [item.name,...item.attributes,...item.operations]) assert.ok(strings.has(text), `PDF must retain selectable text: ${text}`);
  } finally { await parsed.destroy(); }
  await writeFile(path.join(directory, "constructsync-class-diagram.pdf"), bytes);
  const sourceCheck = spawnSync(process.execPath,[cli,"-i",path.join(directory,"constructsync-class-diagram.mmd"),"-o",path.join(temporary,"mermaid-validation.svg"),"-p",configurationPath],{encoding:"utf8",windowsHide:true});
  assert.equal(sourceCheck.status,0,sourceCheck.stderr || sourceCheck.error?.message);
  await writeFile(path.join(directory,"VALIDATION.md"),`# UML class diagram validation\n\nVerified on ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}.\n\n- ${report.classes} classes, ${report.attributes} essential attributes, ${report.operations} conceptual operations, and ${report.associations} associations match CLASS_MODEL.md.\n- Attributes and types match the core ERD; all operations have documented role responsibilities.\n- ${geometry.multiplicities} endpoint multiplicities; one filled composition diamond at MRF; one explicit Delivery XOR ownership note.\n- Source/destination transfer associations have separate labeled routes.\n- Orthogonal association routes have zero crossings, shared segments, or unrelated class intersections.\n- Rendered text fits the class compartments, note, and canvas; endpoint and role labels do not overlap classes, labels, or connector paths.\n- Every visible label is at least ${minimumPoints.toFixed(2)} pt at 240 mm insertion width.\n- PNG is ${page.width*3} by ${page.height*3} pixels. SVG and PDF are approximately ${page.printWidthMm} by ${heightMm.toFixed(2)} mm.\n- PDF is exactly one page with all class names, attributes, and operations selectable.\n- The editable Mermaid source also renders successfully; its automatic layout differs from the fixed publication layout.\n\nBusiness scenario acceptance checks remain in [CLASS_MODEL.md](CLASS_MODEL.md). These are documentation/export checks, not application behavior tests.\n\nRecheck the source with \`node docs/thesis/uml/generate.mjs --check\`; regenerate exports with \`node docs/thesis/uml/export.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"\`.\n`,"utf8");
  console.log(`Exported SVG, PNG, and PDF; Mermaid source rendered successfully. Preview: ${preview}`);
} finally { await browser.close(); }
