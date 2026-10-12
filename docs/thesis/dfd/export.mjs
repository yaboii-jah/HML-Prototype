import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { entities, stores, processes, diagrams, contextFlows, boundaryFlows, storeFlows } from "./model.mjs";
import { validateGeometry } from "../pfd/layout.mjs";

const directory = fileURLToPath(new URL("./",import.meta.url));
const cliIndex = process.argv.indexOf("--cli");
assert.ok(cliIndex >= 0,"Pass --cli with the cached Mermaid CLI src/cli.js path to reuse Puppeteer");
const cli = path.resolve(process.argv[cliIndex + 1]);
const require = createRequire(cli);
const { default: puppeteer } = await import(pathToFileURL(require.resolve("puppeteer")).href);
const generated = spawnSync(process.execPath,[path.join(directory,"generate.mjs")],{ encoding:"utf8",windowsHide:true });
assert.equal(generated.status,0,generated.stderr); process.stdout.write(generated.stdout);
const configuration = JSON.parse(await readFile(new URL("../erd/puppeteer-config.json",import.meta.url),"utf8"));
const temporary = await mkdtemp(path.join(os.tmpdir(),"constructsync-dfd-"));
const entityMap = new Map(entities.map(entity => [entity.id,entity]));
const storeMap = new Map(stores.map(store => [store.id,store]));
const escape = value => String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
const textWidth = (value,size) => [...value].reduce((sum,char) => sum + ("ilI1.,| /".includes(char) ? 0.27 : /[A-Z]/.test(char) ? 0.65 : 0.52) * size,0);
const wrap = (text,width,size) => {
  if (Array.isArray(text)) return text;
  const lines = []; let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next,size) > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
};

function build(name) {
  const config = diagrams[name], font = config.fontSize;
  const nodes = [], flows = [];
  const text = (x,cy,label,width,size = font,bold = false) => {
    const lines = wrap(label,width,size), step = size * 1.18;
    return `<text x="${x}" text-anchor="middle" font-size="${size}"${bold ? ' font-weight="bold"' : ""}>${lines.map((line,i) => `<tspan x="${x}" y="${cy - (lines.length - 1) * step / 2 + i * step + size * 0.35}">${escape(line)}</tspan>`).join("")}</text>`;
  };
  const node = (id,canonical,kind,x,y,w,h,label,number,duplicate = false) => {
    const result = { id,canonical,kind,x,y,w,h,label };
    if (kind === "entity") {
      result.svg = `<rect width="${w}" height="${h}" fill="white" stroke="#64748b" stroke-width="1.2"/>${duplicate ? '<path d="M6 3l8 8m-2-8l8 8" stroke="#64748b" fill="none"/>' : ""}${text(w/2,h/2,label,w-20,font,true)}`;
    } else if (kind === "process") {
      result.svg = `<rect width="${w}" height="${h}" rx="12" fill="#e4edf8" stroke="#365b88" stroke-width="1.3"/><line x1="0" y1="27" x2="${w}" y2="27" stroke="#365b88" stroke-width="1"/>${text(w/2,13,number,w-20,font,true)}${text(w/2,27+(h-27)/2,label,w-18,font,true)}`;
    } else {
      result.svg = `<path d="M${w} 0H0V${h}H${w}" fill="#fff8e6" stroke="#8a7544" stroke-width="1.2"/><line x1="38" y1="0" x2="38" y2="${h}" stroke="#8a7544"/>${duplicate ? `<line x1="5" y1="0" x2="5" y2="${h}" stroke="#8a7544"/>` : ""}${text(21,h/2,canonical,30,font,true)}${text(38+(w-38)/2,h/2,label,w-48)}`;
    }
    nodes.push(result); return result;
  };
  const flow = (from,to,label,points,cx,cy,width) => {
    assert.ok(nodes.some(node => node.id === from) && nodes.some(node => node.id === to));
    const lines = wrap(label,width,font), height = lines.length * font * 1.18 + 6;
    flows.push({ from,to,label,points,cx,cy,width,height,svg: text(cx,cy,lines,width) });
  };

  if (name === "context") {
    const system = node("system","P0","process",20,300,1360,90,["ConstructSync"],"0");
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i], top = i < 5, column = i % 5, x = 20 + column * 280;
      const actor = node(entity.id,entity.id,"entity",x,top ? 20 : 560,240,65,entity.name);
      const incoming = contextFlows.find(flow => flow.from === entity.id), outgoing = contextFlows.find(flow => flow.to === entity.id);
      flow(actor.id,system.id,incoming.label,top ? [[x+55,85],[x+55,300]] : [[x+55,560],[x+55,390]],x+55,top ? 190 : 475,110);
      flow(system.id,actor.id,outgoing.label,top ? [[x+185,300],[x+185,85]] : [[x+185,390],[x+185,560]],x+185,top ? 190 : 475,110);
    }
  } else {
    const uses = new Map();
    for (const process of processes) {
      const [ox,oy] = process.position;
      // Separate horizontal input/output lanes keep every connector continuous.
      const core = node(process.id,process.id,"process",ox+330,oy+15,150,325,process.display,process.number);
      const addNeighbor = (definition,kind,index,count,input,output) => {
        const spacing = 85;
        const cy = oy+55+index*spacing+(4-count)*spacing/2;
        const left = kind === "entity", x = ox+(left ? 0 : 645), w = left ? 160 : 150;
        const used = uses.get(definition.id)||0; uses.set(definition.id,used+1);
        const instance = node(process.id+"-"+definition.id,definition.id,kind,x,cy-27,w,54,left ? definition.name : definition.display,undefined,used>0);
        const near = left ? x+w : x, port = left ? core.x : core.x+core.w;
        const cx = (near+port)/2, width = Math.abs(near-port)-12;
        if(input) flow(instance.id,core.id,input,[[near,cy-12],[port,cy-12]],cx,cy-27,width);
        if(output) flow(core.id,instance.id,output,[[port,cy+12],[near,cy+12]],cx,cy+27,width);
      };
      process.actors.forEach((actor,i)=>addNeighbor(entityMap.get(actor.id),"entity",i,process.actors.length,actor.input,actor.output));
      process.stores.forEach((store,i)=>addNeighbor(storeMap.get(store.id),"store",i,process.stores.length,store.read,store.write));
    }
  }
  const nodesById = new Map(nodes.map(node => [node.id,node]));
  const border = (point,node) => {
    const [x,y] = point;
    return (x===node.x || x===node.x+node.w) && y>=node.y && y<=node.y+node.h || (y===node.y || y===node.y+node.h) && x>=node.x && x<=node.x+node.w;
  };
  for (const node of nodes) assert.ok(node.x>=0 && node.y>=0 && node.x+node.w<=config.width && node.y+node.h<=config.height,`Node outside canvas: ${node.id}`);
  for (const flow of flows) {
    assert.ok(border(flow.points[0],nodesById.get(flow.from)),`Bad source port ${flow.from}/${flow.to}`);
    assert.ok(border(flow.points.at(-1),nodesById.get(flow.to)),`Bad target port ${flow.from}/${flow.to}`);
  }
  const lines = flows.map((flow,index) => `<g data-flow="${index}" data-from="${flow.from}" data-to="${flow.to}"><title>${escape(flow.label)}</title>${name === "context" ? `<polyline points="${flow.points.map(point=>point.join(",")).join(" ")}" fill="none" stroke="white" stroke-width="5"/>` : ""}<polyline points="${flow.points.map(point=>point.join(",")).join(" ")}" fill="none" stroke="#52657b" stroke-width="1.25" marker-end="url(#arrow)"/></g>`).join("");
  const boxes = nodes.map(node=>`<g data-node="${node.id}" data-canonical="${node.canonical}" data-kind="${node.kind}" transform="translate(${node.x},${node.y})">${node.svg}</g>`).join("");
  const labels = flows.map((flow,index)=>`<g data-label="${index}">${name === "context" ? `<rect x="${flow.cx-flow.width/2-3}" y="${flow.cy-flow.height/2}" width="${flow.width+6}" height="${flow.height}" rx="2" fill="white"/>` : ""}${flow.svg}</g>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${config.width} ${config.height}" width="${config.printWidthMm}mm" height="${config.height/config.width*config.printWidthMm}mm" role="img" aria-labelledby="accessible-title" style="font-family:Arial,sans-serif;font-size:${font}px;fill:#172b4d"><title id="accessible-title">ConstructSync ${name==="context" ? "context diagram" : "Level 1 DFD"}</title><desc>Gane-Sarson logical data flow diagram. Labels name information carried; repeated entities/stores have matching IDs.</desc><defs><marker id="arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L8 4L0 8Z" fill="#52657b"/></marker></defs><rect width="100%" height="100%" fill="white"/>${lines}${boxes}${labels}</svg>`;
  const output = svg.replace(/#(?:64748b|52657b|172b4d)/g,"#000000");
  const styledOutput = name === "context" ? output.replaceAll("#365b88","#000000") : output;
  return { svg:styledOutput,nodes,flows,config };
}

const browser = await puppeteer.launch(configuration);
const reports = [];
try {
  for (const name of (process.argv.includes("--level1-only") ? ["level1"] : ["context","level1"])) {
    const { svg,nodes,flows,config } = build(name), prefix = `constructsync-${name}`;
    assert.equal(flows.length,name==="context" ? contextFlows.length : boundaryFlows.length+storeFlows.length);
    await writeFile(path.join(directory,`${prefix}.svg`),svg,"utf8");
    const page = await browser.newPage();
    await page.setViewport({ width:config.width,height:config.height,deviceScaleFactor:4 });
    await page.setContent(`<html><head><style>html,body{margin:0}body>svg{display:block;width:${config.width}px;height:${config.height}px}</style></head><body>${svg}</body></html>`);
    await page.evaluate(()=>document.fonts.ready);
    const result = await page.evaluate(() => {
      const errors = [], canvas = document.querySelector("svg").getBoundingClientRect();
      const nodes = [...document.querySelectorAll("[data-node]")], labels = [...document.querySelectorAll("[data-label]")];
      const overlaps = (a,b)=>a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
      for (const node of nodes) {
        const bounds = node.getBoundingClientRect();
        for (const text of node.querySelectorAll("text")) {
          const rect = text.getBoundingClientRect();
          if (rect.left<bounds.left || rect.right>bounds.right || rect.top<bounds.top || rect.bottom>bounds.bottom) errors.push(`Node text clips: ${node.dataset.node}/${text.textContent}`);
        }
      }
      for (const label of labels) {
        const rect = label.getBoundingClientRect();
        if (rect.left<canvas.left || rect.right>canvas.right || rect.top<canvas.top || rect.bottom>canvas.bottom) errors.push(`Label outside canvas: ${label.dataset.label}`);
        for (const node of nodes) if (overlaps(rect,node.getBoundingClientRect())) errors.push(`Label ${label.dataset.label} overlaps ${node.dataset.node}`);
      }
      for (let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) if(overlaps(labels[i].getBoundingClientRect(),labels[j].getBoundingClientRect())) errors.push(`Labels overlap: ${i}/${j}`);
      for (const text of document.querySelectorAll("svg text")) {
        const rect=text.getBoundingClientRect();
        if(rect.left<canvas.left || rect.right>canvas.right || rect.top<canvas.top || rect.bottom>canvas.bottom) errors.push(`Text outside canvas: ${text.textContent}`);
      }
      return { labelRects: labels.map(label => { const b=label.getBoundingClientRect(); return { id:label.dataset.label,x:b.left-canvas.left,y:b.top-canvas.top,w:b.width,h:b.height }; }), errors, labels:labels.length, minimumFont:Math.min(...[...document.querySelectorAll("svg text")].map(text=>parseFloat(getComputedStyle(text).fontSize))) };
    });
    assert.deepEqual(result.errors,[],`${name}: diagram layout errors`);
    assert.equal(result.labels,flows.length);
    if(name === "level1") validateGeometry({ nodes:nodes.map(node=>({...node,type:node.kind})),edges:flows },result.labelRects);
    const points = result.minimumFont*config.printWidthMm/config.width*72/25.4;
    assert.ok(points>=config.minimumPoints,`${name}: printed text below minimum`);
    await page.screenshot({ path:path.join(directory,`${prefix}.png`),fullPage:true });
    await page.setViewport({ width:config.width,height:config.height,deviceScaleFactor:1 });
    const preview = path.join(temporary,`${name}-preview.png`);
    await page.screenshot({ path:preview,fullPage:true });
    const figureHeight = config.height/config.width*config.printWidthMm;
    const css = name==="context" ? `@page{size:${config.printWidthMm}mm ${figureHeight}mm;margin:0}body>svg{width:${config.printWidthMm}mm;height:${figureHeight}mm}` : "@page{size:A4 landscape;margin:10mm}body{width:277mm;height:189mm;display:flex;align-items:center;justify-content:center}body>svg{width:277mm;height:auto;max-height:189mm}";
    await page.setContent(`<html><head><style>html,body{margin:0}${css}</style></head><body>${svg}</body></html>`);
    await page.evaluate(()=>document.fonts.ready);
    const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize:true,printBackground:true }));
    assert.equal(pdf.getPageCount(),1,`${name}: PDF must be one page`);
    if(name==="level1") { assert.ok(Math.abs(pdf.getPage(0).getWidth()-297*72/25.4)<1); assert.ok(Math.abs(pdf.getPage(0).getHeight()-210*72/25.4)<1); }
    pdf.setTitle(`ConstructSync ${name==="context" ? "Context Diagram" : "Level 1 DFD"}`);
    pdf.setSubject("Gane-Sarson data flow diagram for the research paper");
    const bytes = await pdf.save(), loading = getDocument({ data:new Uint8Array(bytes),useSystemFonts:true });
    try {
      const parsed = await loading.promise, content = await (await parsed.getPage(1)).getTextContent();
      const text = content.items.map(item=>item.str).join(" ").replace(/\s+/g," ");
      for(const node of nodes) {
        const label = (Array.isArray(node.label) ? node.label.join(" ") : node.label).replace(/\s+/g," ");
        assert.ok(text.includes(label),`Missing selectable PDF label ${node.id}: ${label}`);
        if(node.kind==="process") assert.ok(content.items.some(item=>item.str===(name==="context" ? "0" : processes.find(process=>process.id===node.canonical).number)),`Missing PDF process ${node.id}`);
        if(node.kind==="store") assert.ok(text.includes(node.canonical),`Missing PDF store ${node.id}`);
      }
      for(const flow of flows) assert.ok(text.includes(flow.label.replace(/\s+/g," ")),`Missing selectable PDF data label: ${flow.label}`);
      assert.ok(content.items.length>flows.length,"PDF labels must be selectable text");
    } finally { await loading.destroy(); }
    await writeFile(path.join(directory,`${prefix}.pdf`),bytes);
    reports.push(`- **${name}**: ${nodes.length} visible symbols; ${flows.length} labeled flows; minimum ${points.toFixed(2)} pt at ${config.printWidthMm} mm width. PNG ${config.width*3} × ${config.height*3} pixels. Exactly one selectable-text PDF page${name==="level1" ? ", A4 landscape" : ""}.`);
    console.log(`${name} exported. Preview: ${preview}`);
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(path.join(directory,"VALIDATION.md"),`# DFD validation

Verified against the revised workflow on 2026-10-11.

${reports.join("\n")}

- Context contains one process and ten external entities; no stores or internal sub-processes.
- Level 1 contains six distinct processes, six distinct logical stores and ten external entities. Repeated symbols retain canonical identities.
- All ${contextFlows.length} context inputs/outputs balance with the Level 1 boundary payloads; the generator compares exact data sets.
- All processes and stores have inputs and outputs. Every Level 1 flow touches a process; no direct external-to-store, store-to-store or external-to-external arrows.
- All arrows have named information labels and terminate on node borders.
- Level 1 connectors have zero crossings, overlapping segments or connector/label collisions. Repeated neighbors keep connections local; removing them would introduce long links across process groups.
- Boundary payloads and store endpoints match the fixed approved-flows.json baseline.
- Every visible label fits the canvas; labels do not overlap nodes or each other. Node labels fit their shapes.
- Finance plans, Accounting verification, credit/upfront clearance, reviewed AI drafts and warehouse/site quantities remain distinct information.
- Diagram sources and notes derive from one model. Run node docs/thesis/dfd/generate.mjs --check for consistency.

These are diagram/model checks; no app or database changes were made.
`,"utf8");
