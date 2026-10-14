import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { model as erd } from "../erd/model.mjs";
import { validateGeometry } from "../pfd/layout.mjs";

const specification = readFileSync(new URL("CLASS_MODEL.md", import.meta.url), "utf8");
const table = heading => specification.split(`## ${heading}\n`)[1].split("\n## ")[0]
  .split("\n").filter(line => line.startsWith("|")).slice(2)
  .map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));

export const page = { width: 1650, height: 1230, printWidthMm: 240, fontSize: 22, labelSize: 21 };
export const boxWidth = 300, headerHeight = 42, rowHeight = 29, padding = 24;
const positions = {
  User: [30, 30], MRFItem: [460, 30], Quotation: [890, 30], Supplier: [1320, 30],
  Project: [30, 410], MRF: [460, 410], PurchaseOrder: [890, 410], VerifiedPayment: [1320, 410],
  InventoryMovement: [30, 850], StockTransfer: [460, 850], Delivery: [890, 850],
};
const byErdName = new Map(erd.entities.map(entity => [entity.title.replaceAll(" ", ""), entity]));
export const classes = table("Core classes").map(([name, meaning, attributes, operations]) => ({
  name, meaning, attributes: attributes.split("; "), operations: operations.split("; "),
  position: positions[name], color: byErdName.get(name)?.color,
}));
export const boxHeight = item => headerHeight + padding * 2 + rowHeight * (item.attributes.length + item.operations.length);
export const byName = new Map(classes.map(item => [item.name, item]));
const bottom = name => byName.get(name).position[1] + boxHeight(byName.get(name));

export const associations = [
  { from: "User", to: "MRF", a: "1", b: "0..*", points: [[330,200],[400,200],[400,370],[510,370],[510,410]] },
  { from: "User", to: "Project", a: "0..*", b: "0..*", role: "assigned sites", labelAt: [163,374,"end"], points: [[180,bottom("User")],[180,410]] },
  { from: "Project", to: "MRF", a: "1", b: "0..*", points: [[330,500],[460,500]] },
  { from: "MRF", to: "MRFItem", a: "1", b: "0..*", composition: true, points: [[610,410],[610,bottom("MRFItem")]] },
  { from: "MRF", to: "Quotation", a: "1", b: "0..*", points: [[760,460],[820,460],[820,200],[890,200]] },
  { from: "Supplier", to: "Quotation", a: "1", b: "0..*", points: [[1320,150],[1190,150]] },
  { from: "MRF", to: "PurchaseOrder", a: "1", b: "0..*", points: [[760,580],[890,580]] },
  { from: "Quotation", to: "PurchaseOrder", a: "1", b: "0..*", points: [[1040,bottom("Quotation")],[1040,410]] },
  { from: "Supplier", to: "PurchaseOrder", a: "1", b: "0..*", points: [[1470,bottom("Supplier")],[1470,350],[1160,350],[1160,410]] },
  { from: "PurchaseOrder", to: "VerifiedPayment", a: "1", b: "0..*", points: [[1190,580],[1320,580]] },
  { from: "PurchaseOrder", to: "Delivery", a: "0..1", b: "0..*", points: [[1040,bottom("PurchaseOrder")],[1040,850]] },
  { from: "StockTransfer", to: "Delivery", a: "0..1", b: "0..*", points: [[760,1010],[890,1010]] },
  { from: "MRF", to: "StockTransfer", a: "1", b: "0..*", points: [[610,bottom("MRF")],[610,850]] },
  { from: "Project", to: "StockTransfer", a: "1", b: "0..*", role: "source", labelAt: [411,775,"start"], endLabelAt: [446,983,"end"], points: [[330,620],[400,620],[400,960],[460,960]] },
  { from: "Project", to: "StockTransfer", a: "1", b: "0..*", role: "destination", labelAt: [357,815,"end"], endLabelAt: [446,1018,"end"], points: [[330,680],[370,680],[370,995],[460,995]] },
  { from: "Project", to: "InventoryMovement", a: "1", b: "0..*", points: [[180,bottom("Project")],[180,850]] },
  { from: "Delivery", to: "InventoryMovement", a: "0..1", b: "0..*", points: [[890,1100],[820,1100],[820,1200],[180,1200],[180,bottom("InventoryMovement")]] },
];

export const constraint = {
  x: 1320, y: 850, w: 300, h: 150,
  lines: ["{xor}", "Exactly one owner:", "PurchaseOrder or", "StockTransfer."],
  leader: [[1190,930],[1320,930]],
};

export function validateModel() {
  assert.equal(classes.length, 11);
  assert.equal(byName.size, classes.length);
  assert.deepEqual(new Set(byName.keys()), new Set(byErdName.keys()));
  let attributeCount = 0, operationCount = 0;
  const typeMap = { uuid: "UUID", string: "String", decimal: "Decimal", boolean: "Boolean", date: "Date", datetime: "DateTime" };
  const operationDefinitions = new Set(table("Operation meanings and responsibilities").map(row => row[0]));
  for (const item of classes) {
    const entity = byErdName.get(item.name);
    assert.ok(item.position && item.color);
    assert.ok(item.attributes.length >= 3 && item.attributes.length <= 5);
    for (const attribute of item.attributes) {
      const [name, type] = attribute.split(": ");
      const fieldName = name === "id" ? entity.fields.find(field => field.key === "PK").name : name.replace(/[A-Z]/g, letter => "_" + letter.toLowerCase());
      const field = entity.fields.find(field => field.name === fieldName);
      assert.ok(field, `${item.name}.${name} must exist in the ERD`);
      assert.equal(type, name === "role" ? "Role" : typeMap[field.type]);
      attributeCount++;
    }
    for (const operation of item.operations) {
      assert.ok(operationDefinitions.has(`${item.name}.${operation}`));
      operationCount++;
    }
  }
  assert.equal(operationCount, operationDefinitions.size);
  const keys = associations.map(link => `${link.from} ${link.a} — ${link.b} ${link.to}${["source","destination"].includes(link.role) ? ` (${link.role})` : ""}`);
  assert.deepEqual(new Set(keys), new Set(table("Associations and multiplicities").map(row => row[0])));
  assert.equal(associations.filter(link => link.composition).length, 1);
  assert.equal(associations.find(link => link.composition).from, "MRF");
  const geometry = validateGeometry({
    nodes: classes.map(item => ({ id: item.name, x: item.position[0], y: item.position[1], w: boxWidth, h: boxHeight(item) })),
    edges: associations,
  });
  return { classes: classes.length, attributes: attributeCount, operations: operationCount, associations: associations.length, ...geometry };
}

export function mermaidSource() {
  const classText = classes.map(item => `    class ${item.name} {\n${item.attributes.map(attribute => {
    const [name, type] = attribute.split(": ");
    return `        ${type} ${name}`;
  }).join("\n")}\n${item.operations.map(operation => `        ${operation}`).join("\n")}\n    }`).join("\n\n");
  const links = associations.map(link => `    ${link.from} "${link.a}" ${link.composition ? "*--" : "--"} "${link.b}" ${link.to}${link.role ? ` : ${link.role}` : ""}`).join("\n");
  return `---\nconfig:\n  theme: neutral\n  look: classic\n  layout: dagre\n  class:\n    hideEmptyMembersBox: true\n---\nclassDiagram\n    direction TB\n\n${classText}\n\n${links}\n\n    note for Delivery "{xor}: exactly one owner\\nPurchaseOrder or StockTransfer"\n\n%% Conceptual business operations; supporting classes remain outside the core view.\n`;
}
