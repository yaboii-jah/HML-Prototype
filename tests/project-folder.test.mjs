import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand } from "../src/domain/commands.ts";
import { bindAccountCommands } from "../src/app-state/command-gateway.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
const admin = { name: "Folder Admin", email: "admin@example.com", role: "Administrator" };
let seq = 0;
const context = actor => ({ actor, now: () => "2026-10-09T00:00:00Z", id: prefix => `${prefix}-${++seq}` });
function workspace() {
  let snapshot = seedDemo(), active = admin;
  const repository = { getSnapshot: () => ({ snapshot }), execute: async (command, actor) => { const result = applyCommand(snapshot, command, context(actor)); if (result.ok) snapshot = result.snapshot; return result; } };
  const gateway = bindAccountCommands(repository, admin, () => active);
  return { gateway, repository, get: () => snapshot, change: value => { active = value; }, add: () => repository.execute({ type: "addSite", documentCode: "FOLDER-" + seq, name: `Folder project ${seq}`, location: "Pasig", budget: 100 }, admin) };
}
test("project folder setup persists failures and clears them after automatic or manual mapping", async () => {
  const work = workspace(), created = await work.add(), id = created.recordId;
  assert.equal(created.snapshot.sites.find(s => s.id === id).driveFolderSetup.status, "pending");
  let operation = await work.gateway.beginOperation({ kind: "project", id });
  assert.equal((await operation({ type: "failProjectFolder", siteId: id, error: "Permission denied" })).ok, true);
  assert.equal(work.get().sites.find(s => s.id === id).driveFolderSetup.error, "Permission denied");
  operation = await work.gateway.beginOperation({ kind: "project", id });
  assert.equal(work.get().activity[0].eventType, "operation.retried");
  assert.equal((await operation({ type: "completeProjectFolder", siteId: id, folderId: "automatic-folder" })).ok, true);
  assert.deepEqual(work.get().sites.find(s => s.id === id).driveFolderSetup, { status: "ready" });
  assert.equal((await work.gateway.run({ type: "setProjectDriveFolder", siteId: id, folderId: "manual-folder" })).ok, true);
  assert.equal(work.get().sites.find(s => s.id === id).driveFolderId, "manual-folder");
});
test("project folder operation preserves initiator and rejects stale or cross-project responses", async () => {
  const work = workspace(), id = (await work.add()).recordId;
  const operation = await work.gateway.beginOperation({ kind: "project", id });
  assert.equal((await operation({ type: "completeProjectFolder", siteId: "other", folderId: "wrong" })).ok, false);
  work.change({ name: "Other", email: "other@example.com", role: "Finance" });
  assert.equal((await operation({ type: "completeProjectFolder", siteId: id, folderId: "correct" })).ok, true);
  assert.equal(work.get().activity[0].actorIdentity.email, admin.email);
  const second = workspace(), secondId = (await second.add()).recordId;
  const delayed = await second.gateway.beginOperation({ kind: "project", id: secondId });
  await second.gateway.run({ type: "setProjectDriveFolder", siteId: secondId, folderId: "manual-folder" });
  assert.equal((await delayed({ type: "completeProjectFolder", siteId: secondId, folderId: "late-folder" })).ok, false);
  assert.equal(second.get().sites.find(s => s.id === secondId).driveFolderId, "manual-folder");
  const denied = applyCommand(second.get(), { type: "failProjectFolder", siteId: secondId, error: "wrong role" }, context({ name: "User", email: "user@example.com", role: "Procurement" }));
  assert.equal(denied.ok, false);
});

test("automatic folder setup makes one request for double clicks and retains a retryable failed project", async t => {
  const { setupProjectFolder } = await import("../src/features/admin/project-folder.ts");
  const previousFetch = globalThis.fetch; t.after(() => { globalThis.fetch = previousFetch; });
  const work = workspace(), created = await work.add(), site = created.snapshot.sites.find(s => s.id === created.recordId);
  let calls = 0, release;
  globalThis.fetch = async () => { calls++; await new Promise(resolve => { release = resolve; }); return Response.json({ error: "Drive unavailable" }, { status: 503 }); };
  const first = setupProjectFolder(site, work.gateway.beginOperation), second = setupProjectFolder(site, work.gateway.beginOperation);
  assert.equal(first, second);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release(); assert.equal(await first, false); assert.equal(calls, 1);
  assert.equal(work.get().sites.find(s => s.id === site.id).driveFolderSetup.error, "Drive unavailable");
  globalThis.fetch = async () => { calls++; return Response.json({ id: "recovered-folder" }); };
  assert.equal(await setupProjectFolder(work.get().sites.find(s => s.id === site.id), work.gateway.beginOperation), true);
  assert.equal(calls, 2);
  assert.equal(work.get().sites.find(s => s.id === site.id).driveFolderId, "recovered-folder");
});
