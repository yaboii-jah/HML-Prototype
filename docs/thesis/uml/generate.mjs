import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { mermaidSource, validateModel } from "./model.mjs";

const report = validateModel();
const source = new URL("constructsync-class-diagram.mmd", import.meta.url);
const content = mermaidSource();
if (process.argv.includes("--check")) assert.equal(await readFile(source, "utf8"), content, "Mermaid source differs from the approved class specification");
else await writeFile(source, content, "utf8");
console.log(`${process.argv.includes("--check") ? "Checked" : "Generated"} UML source: ${report.classes} classes, ${report.attributes} attributes, ${report.operations} operations, ${report.associations} associations; no connector crossings.`);
