import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const cliIndex = process.argv.indexOf("--cli");
assert.ok(cliIndex>=0 && process.argv[cliIndex+1],"Pass --cli with the cached Mermaid CLI src/cli.js path");
const onlyIndex = process.argv.indexOf("--only");
const names = onlyIndex>=0 ? [process.argv[onlyIndex+1]] : ["erd","dfd","pfd","uml"];
for(const name of names) {
  assert.ok(["erd","dfd","pfd","uml"].includes(name),"--only accepts erd, dfd, pfd or uml");
  const script = fileURLToPath(new URL(`./${name}/export.mjs`,import.meta.url));
  const result = spawnSync(process.execPath,[script,"--cli",process.argv[cliIndex+1]],{stdio:"inherit",windowsHide:true});
  if(result.error) throw result.error;
  if(result.status!==0) process.exit(result.status || 1);
}

if(process.argv.includes("--validate-mermaid")) {
  const temporary = mkdtempSync(path.join(os.tmpdir(),"constructsync-mermaid-check-"));
  const sources = { erd:["erd"], dfd:["context","level1"], pfd:["overview","purchasing","payments","stock-transfer","delivery-receiving","document-review"], uml:["class-diagram"] };
  const configuration = fileURLToPath(new URL("./erd/puppeteer-config.json",import.meta.url));
  for(const name of names) for(const id of sources[name]) {
    const source = fileURLToPath(new URL(`./${name}/constructsync-${id}.mmd`,import.meta.url));
    const output = path.join(temporary,`${name}-${id}.svg`);
    const result = spawnSync(process.execPath,[process.argv[cliIndex+1],"-i",source,"-o",output,"-p",configuration],{stdio:"inherit",windowsHide:true});
    if(result.error) throw result.error;
    if(result.status!==0) process.exit(result.status || 1);
    console.log(`Mermaid source rendered: ${name}/${id}`);
  }
}
