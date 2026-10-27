import { initializedWorkspaceStorage } from './helpers/initialized-storage.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/domain/commands.ts';
import { adminActivityGroups, activityDateKey, activityRangeError, emptyActivityFilters } from '../src/domain/admin-activity.ts';
import { auditProjectId, auditRecords } from '../src/domain/audit.ts';
import { projectMinimumBudget, projectScopes } from '../src/domain/scope-budgets.ts';
import { seedDemo } from './fixtures/workspace.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';

const admin = { name: 'Daniel Garcia', email: 'admin@example.com', role: 'Administrator' };
let sequence = 0;
const context = actor => ({ actor, now: () => '2026-10-07T03:00:00Z', id: prefix => `${prefix}-admin-${++sequence}` });
const execute = (state, command, actor = admin) => { const result = applyCommand(state, command, context(actor)); assert.equal(result.ok, true, result.message); return result.snapshot; };
const rejected = (state, command, pattern, actor = admin) => { const before = structuredClone(state), result = applyCommand(state, command, context(actor)); assert.equal(result.ok, false); assert.match(result.message, pattern); assert.deepEqual(state, before); };

test('project editing preserves links, document snapshots and historical actors while recording changed fields', () => {
  const initial = seedDemo(), before = structuredClone(initial), site = initial.sites[0];
  const state = execute(initial, { type: 'updateSite', siteId: site.id, name: ' Updated tower ', location: ' Marikina ', budget: site.budget + 1000 });
  assert.deepEqual(initial, before);
  assert.deepEqual(state.sites[0], { ...site, name: 'Updated tower', location: 'Marikina', budget: site.budget + 1000 });
  for (const key of ['requests','pos','quotes','batches','payments','scopes']) assert.deepEqual(state[key], before[key]);
  assert.deepEqual(state.activity.slice(1), before.activity);
  assert.equal(state.activity[0].projectId, site.id); assert.equal(state.activity[0].eventType, 'project.updated');
  assert.equal(state.activity[0].actorIdentity.name, admin.name);
  assert.deepEqual(state.activity[0].changedFields, ['Project name','Location','Allocated budget']);
});

test('project editing enforces existing cap obligations and project editor access, including unscoped legacy POs', () => {
  const state = seedDemo(), site = state.sites[0], command = { type: 'updateSite', siteId: site.id, name: site.name, location: site.location, budget: site.budget };
  rejected(state, command, /Administrator/, { ...admin, role: 'Finance' });
  rejected(state, { ...command, siteId: 'missing' }, /not found/);
  rejected(state, { ...command, name: ' ' }, /Complete/);
  rejected(state, { ...command, name: state.sites[1].name.toUpperCase() }, /unique/);
  for (const budget of [-1, NaN, Infinity]) rejected(state, { ...command, budget }, /valid/);
  rejected(state, { ...command, budget: projectMinimumBudget(state, site.id) - 0.01 }, /scope allocations/);
  const legacy = structuredClone(state); legacy.scopes = []; legacy.requests.forEach(request => delete request.scopeId);
  assert.ok(projectMinimumBudget(legacy, site.id) > 0);
  rejected(legacy, { ...command, budget: 0 }, /committed and spent/);
  const unchanged = execute(state, command); assert.deepEqual(unchanged, state);
});

test('only unused scopes can be removed, returning allocations without changing the project budget', () => {
  const initial = seedDemo();
  let state = execute(initial, { type: 'updateSite', siteId: 'site-a', name: initial.sites[0].name, location: initial.sites[0].location, budget: initial.sites[0].budget + 1000 });
  state = execute(state, { type: 'saveProjectScope', siteId: 'site-a', name: 'Unused fitout', budget: 1000 });
  const scope = state.scopes.at(-1), budget = state.sites[0].budget, allocations = projectScopes(state, 'site-a').reduce((sum,value)=>sum+value.budget,0);
  const command = { type: 'removeProjectScope', siteId: 'site-a', id: scope.id };
  rejected(state, command, /Administrator/, { ...admin, role: 'Procurement' });
  rejected(state, { ...command, siteId: 'site-b' }, /not found/);
  for (const status of ['draft','submitted','approved','returned','rejected']) {
    const used = structuredClone(state); used.requests.push({ ...structuredClone(state.requests[0]), id: 'linked-'+status, scopeId: scope.id, status });
    rejected(used, command, /used by an MRF/);
  }
  state = execute(state, command);
  assert.equal(state.sites[0].budget,budget); assert.equal(projectScopes(state,'site-a').reduce((sum,value)=>sum+value.budget,0),allocations-1000);
  assert.equal(state.scopes.some(value=>value.id===scope.id),false);
  const event=state.activity[0]; assert.equal(event.entityRef,'Unused fitout'); assert.equal(event.projectId,'site-a'); assert.equal(event.eventType,'scope.removed');
  assert.equal(auditRecords(state).has(scope.id),false); assert.equal(auditProjectId(state,event),'site-a');
});

test('unchanged folder mappings suppress duplicate audit entries and mapping updates retain project ownership', () => {
  const initial=seedDemo(), site=initial.sites[0]; site.driveFolderId='saved-folder';
  assert.deepEqual(execute(initial,{type:'setProjectDriveFolder',siteId:site.id,folderId:' saved-folder '}),initial);
  const state=execute(initial,{type:'setProjectDriveFolder',siteId:site.id,folderId:'new-folder'});
  assert.equal(state.activity[0].projectId,site.id); assert.deepEqual(state.activity[0].changedFields,['Google Drive folder']);
});

test('activity filters use inclusive Philippine dates, actual actors and preserved original grouping boundaries', () => {
  const state=seedDemo(), actor={name:'Andrea Reyes',email:'buyer@example.com',role:'Procurement'};
  const event=(id,at,overrides={})=>({id,entity:'q1',requestId:'m1',projectId:'site-a',actor:'Procurement',actorIdentity:actor,eventType:'quote.draft.updated',action:'Quotation draft updated',at,changedFields:['Unit price'],...overrides});
  state.activity=[event('next-day','2026-10-07T16:00:10Z'),event('last-second','2026-10-07T15:59:50Z'),event('interruption','2026-10-07T15:59:40Z',{eventType:'request.reviewed',actor:'Finance',entity:'m1'}),event('previous-save','2026-10-07T15:59:30Z'),event('unknown','invalid',{entity:'missing',projectId:undefined,requestId:undefined,eventType:undefined,action:'Mention Site A without ownership'})];
  const before=structuredClone(state), filters={...emptyActivityFilters,from:'2026-10-07',to:'2026-10-07',project:'site-a',department:'Procurement',search:'Andrea'};
  const groups=adminActivityGroups(state,filters);
  assert.deepEqual(groups.map(group=>group.entries.map(value=>value.id)),[['last-second'],['previous-save']]);
  assert.equal(activityDateKey('2026-10-07T16:00:00Z'),'2026-10-08');
  assert.equal(activityDateKey('2026-10-07T15:59:59Z'),'2026-10-07');
  assert.equal(activityDateKey('invalid'),'');
  assert.match(activityRangeError({...filters,from:'2026-10-08',to:'2026-10-07'}),/end date/);
  assert.match(activityRangeError({from:'2026-02-30',to:''}),/valid dates/);
  assert.equal(adminActivityGroups(state,{...emptyActivityFilters,project:'unassigned'}).flatMap(group=>group.entries).at(-1).id,'unknown');
  assert.deepEqual(state,before);
});

test('project filtering resolves explicit legacy links and preserves removed-record ownership without guessing from text', () => {
  const initial=seedDemo();
  let state=execute(initial,{type:'updateSite',siteId:'site-a',name:initial.sites[0].name,location:initial.sites[0].location,budget:initial.sites[0].budget+100});
  state=execute(state,{type:'saveProjectScope',siteId:'site-a',name:'Temporary scope',budget:100});
  state=execute(state,{type:'removeProjectScope',siteId:'site-a',id:state.scopes.at(-1).id});
  state.activity.push({id:'legacy-po',entity:'po1',at:'2026-10-07T02:00:00Z',actor:'Project Manager',action:'Historical review'}, {id:'unlinked',entity:'gone',at:'2026-10-07T01:00:00Z',actor:'Administrator',action:state.sites[0].name});
  const groups=adminActivityGroups(state,{...emptyActivityFilters,project:'site-a'}), entries=groups.flatMap(group=>group.entries);
  assert.ok(entries.some(event=>event.eventType==='scope.removed'));
  assert.ok(entries.some(event=>event.id==='legacy-po')); assert.equal(entries.some(event=>event.id==='unlinked'),false);
  assert.equal(adminActivityGroups(state,{...emptyActivityFilters,department:'Project Manager'}).length,1);
});

test('new admin audit metadata survives schema-12 reload without rewriting stored history', async () => {
  const state=execute(seedDemo(),{type:'updateSite',siteId:'site-a',name:'Updated project',location:'Pasig',budget:800000});
  const raw=JSON.stringify(state), priorWindow=globalThis.window, priorStorage=globalThis.localStorage;
  let writes=0; globalThis.window={addEventListener(){}}; globalThis.localStorage=initializedWorkspaceStorage({getItem:key=>key==='hml-constructsync-demo-v12'?raw:null,setItem(){writes++;}});
  try { const view=await new LocalDemoRepository().load(); assert.equal(view.status,'ready'); assert.equal(writes,0); assert.deepEqual(view.snapshot.activity,JSON.parse(raw).activity); }
  finally {globalThis.window=priorWindow;globalThis.localStorage=priorStorage;}
});
