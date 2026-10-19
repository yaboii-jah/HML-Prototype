import assert from 'node:assert/strict';
import { reviewedMrf372Samples } from './fixtures/mrf372-reviewed.mjs';
import { mrf372FlowScenarios } from './mrf372-flow-scenarios.mjs';
import { consumptionRows } from '../src/domain/consumption.ts';
import { businessDate } from '../src/domain/business-dates.ts';
import { inventoryFor } from '../src/domain/selectors.ts';
import { materialId } from '../src/domain/ids.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { parseCurrent } from '../src/mock/repository.ts';

export async function capstoneModuleScenarios() {
  const samples = await reviewedMrf372Samples();
  const flow = await mrf372FlowScenarios({ samples, groupedUsage: true });
  const from = title => {
    const checkpoint = flow.checkpoints.find(item => item.title === title);
    assert.ok(checkpoint, `Source checkpoint: ${title}`);
    return checkpoint;
  };
  const state = flow.final, request = state.requests[0], siteId = request.siteId;
  const site = state.sites.find(item => item.id === siteId);
  const usage = state.usageEntries[0];
  const final = { snapshot: state, refs: { sourceMRF: 'MRF-372', mrf: request.ref } };
  const issuance = from('Procurement Issuance of Approved Kestrel Purchase Order');
  const checkpoints = [];
  const add = (module, title, role, basis, route, setup, purpose, expectedText = []) => {
    const checkpoint = {
      number: checkpoints.length + 1, module, title, role, route: route || basis.route,
      setup: setup || basis.setup || [], refs: structuredClone(basis.refs), purpose,
      importance: checkpoints.length < 12 ? 'primary' : 'supporting',
      expectedText, snapshot: structuredClone(basis.snapshot),
    };
    checkpoint.snapshot.role = role;
    assert.ok(parseCurrent(JSON.stringify(checkpoint.snapshot)), `Loadable snapshot: ${title}`);
    checkpoints.push(checkpoint);
    return checkpoint;
  };
  add('Dashboard', 'Operational dashboard and outstanding department tasks', 'Procurement', issuance, '/dashboard', [],
    'The dashboard brings together operational counts, department actions and project budget positions. This stage includes an approved PO awaiting Procurement issuance.', ['Waiting for your role', 'Issue PO']);
  add('Projects', 'Project budget and scope allocation', 'Project Manager', final, `/projects/${siteId}`, [],
    'Project details show the overall allocation, commitments, spending and available funds, with an Architectural scope linked to MRF 372.', ['Scope', 'Architectural']);
  add('Material requests', 'Material request quantities and approval controls', 'Project Manager', from('Project Manager Review of MRF 372 and Original Attachment'), undefined, [{ heading: 'Goods · 8 materials' }],
    'The Project Manager checks eight requested materials, quantities, required dates, delivery locations and site stock before approving, returning or rejecting the request. The same record retains the source reference and supporting MRF, key plan and scope PDF.', ['MRF-372', 'Goods · 8 materials']);
  add('Purchase orders', 'Approved purchase order and supplier issuance controls', 'Procurement', issuance, undefined, undefined,
    'Procurement confirms issuance of an Accounting-approved and archived purchase order. The selected PO covers seven requested materials from Kestrel.', ['Supplier issuance', 'MSR-PO-0001']);
  add('Suppliers', 'Supplier directory populated from reviewed quotations', 'Procurement', final, '/suppliers', [],
    'The supplier directory contains Meridian, Apex, Summit and Kestrel from the four reviewed sample quotations, with access to quotation history.', ['MERIDIAN', 'APEX', 'SUMMIT', 'KESTREL']);
  add('Accounting', 'Purchase order costing and budget approval', 'Accounting / Auditing', from('Apex Credit Terms and Agreed Supplier Payment Due Date'), undefined, [{ collapse: '.accounting-po-review details' }, { heading: 'Supplier and materials' }],
    'Accounting checks the supplier material costs, net payable and available project and Architectural scope funds before approving the Apex credit PO. Withholding reduces the supplier payable from the VAT-inclusive material total.', ['PO charges and deductions', 'Approve']);
  checkpoints.at(-1).uiChecks = [{ expression: 'const r=document.querySelector(".accounting-po-review button[value=approve]").getBoundingClientRect();return r.top>55&&r.bottom<innerHeight;', message: 'Accounting approval controls are visible' }];
  add('Finance', 'External supplier payment coordination', 'Finance', from('Finance Upfront Payable and Payment Coordination Summary'), undefined, [],
    'Finance coordinates an external supplier payment using priority, processing status, planned payment date and notes. Scheduled coordination does not establish verified payment.', ['Scheduled', 'Update coordination']);
  add('Deliveries', 'Site receiving and accepted delivery quantities', 'Site Personnel', from('Kestrel Site Receiving and Accepted Material Quantities'), undefined, undefined,
    'Site Personnel confirms received quantities against a dispatched supplier delivery and records any shortage or damage before a separate stock-posting step.', ['Confirm received quantities']);
  add('Stock transfers', 'Inter-project stock transfer and delivery trip', 'Logistics', from('Stock Transfer Trip Dispatch from Source Site'), undefined, [],
    'A source-approved transfer moves four matching glass clamps from Cavite to Marina Skyline. Logistics records dispatch separately from destination receiving and posting.', ['Source', 'Destination', 'Record dispatch']);
  add('Inventory', 'Project stock after receipts transfers and usage', 'Site Personnel', final, '/inventory', [{ fill: '[aria-label="Site context"]', value: siteId }],
    'The stock register shows the destination project’s posted supplier and transfer receipts after usage. Its 60 clamps combine 56 purchased pieces and four transferred pieces.', ['Site inventory', '60']);
  add('Reports', 'Management purchasing budget and workflow report', 'Project Manager', from('Management Purchasing Budget and Workflow Report'), undefined, undefined,
    'Management reports consolidate project funding, purchasing volume, workflow status and exceptions for the connected MRF 372 transactions.', ['Project budget position', 'Workflow mix']);
  add('Administration', 'Department users and site project assignments', 'Administrator', final, '/admin', [
    { click: 'Users', buttonSelector: '[role=tab]' },
    { fill: '[aria-label="Search users"]', value: 'Miguel Santos' },
    { click: 'Edit' },
    { waitSelector: '.user-project-assignments' },
  ], 'Administrator manages named department accounts and assigns Site Personnel to projects. The example shows the destination and source projects assigned to the site account.', ['Project assignments', site.name]);
  const quoteReview = from('KESTREL Quotation Material Matching and Original PDF');
  add('Material requests', 'Supplier quotation review beside the original PDF', 'Procurement', quoteReview, undefined, [
    { step: 2 }, { selector: '.quote-material-workspace' }, { waitSelector: '.quote-material-workspace .pdfViewer canvas' },
  ], 'Procurement checks Kestrel’s original quotation alongside the offered-material worksheet, confirming material links, quantities and prices before finalization.', ['KGS-Q-0917', 'Offered materials']);
  const awards = from('Lowest Compliant Supplier Awards and Remaining Purchase Quantities');
  add('Material requests', 'Comparative bidding and saved supplier awards', 'Procurement', awards, undefined, [
    { step: 3 }, { clickSelector: '[aria-label="Collapse sidebar"]' }, { collapse: '.bid-comparison-reports' }, { heading: 'Compare & award' }, { horizontal: '.comparative-bid-scroll' },
  ], 'Four supplier quotations support the comparison. The native horizontally scrolling table is positioned to show the winning Kestrel prices and saved awards. Apex supplies 56 clamps, Kestrel supplies the other seven materials, and four clamps come from site stock.', ['Compare & award', 'MERIDIAN', 'APEX', 'SUMMIT', 'KESTREL']);
  // Keep the app's native scrollable comparison and expose the winning offers.
  checkpoints.at(-1).viewport = { width: 2000, height: 1250, deviceScaleFactor: 1.6 };
  checkpoints.at(-1).uiChecks = [{ expression: 'const el=document.querySelector(".comparative-bid-scroll"),r=el.getBoundingClientRect(),k=[...el.querySelectorAll(".bid-supplier-heading")].at(-1).getBoundingClientRect();return el.scrollLeft>0&&k.left>=r.left&&k.right<r.right;', message: 'Winning supplier columns are visible in the native comparison' }];
  add('Inventory', 'Grouped material usage and recorded responsibility', 'Site Personnel', final, `/inventory/usage/${usage.id}`, [],
    'One immutable usage entry records two installed glass panels and one silicone cartridge, with a shared explanation, material-specific reasons, named actor and timestamp.', ['2 materials', 'One silicone cartridge', 'Two 900']);
  const today = businessDate();
  add('Inventory', 'Material consumption and closing stock reconciliation', 'Site Personnel', final, '/inventory?view=consumption', [
    { fill: '[aria-label="Consumption from date"]', value: today },
    { fill: '[aria-label="Consumption to date"]', value: today },
    { fill: '[aria-label="Search consumption"]', value: 'GLASS' },
  ], 'The glass-material filter shows source and destination stock together: four clamps transferred out of the source, 60 clamps at the destination, and two panels used with 10 remaining. The report reconciles an inclusive Philippine date range.', ['Material consumption', 'Closing', 'Transferred out']);
  checkpoints.at(-1).uiChecks = [{ expression: 'const rows=[...document.querySelectorAll(".consumption-report tbody tr")];return rows.length===5&&rows.some(r=>r.cells[0].innerText.includes("900 x 2100mm")&&r.cells[4].innerText.trim()==="2"&&r.cells[7].innerText.trim()==="10")&&rows.some(r=>r.cells[1].innerText.includes("Cavite")&&r.cells[5].innerText.trim()==="4"&&r.cells[7].innerText.trim()==="16");', message: 'Consumption displays usage and transfer arithmetic together' }];

  const rows = consumptionRows(state, { from: today, to: today, projectIds: state.sites.map(project => project.id) });
  for (const project of state.sites) for (const material of inventoryFor(state, project.id)) {
    const row = rows.find(value => value.siteId === project.id && value.id === material.id);
    assert.equal(row?.closing, material.onHand, `Consumption reconciles: ${material.name} at ${project.name}`);
  }
  assert.equal(usage.movementIds.length, 2);
  assert.equal(state.movements.filter(m => m.kind === 'usage').length, 2, 'One deduction per grouped material');
  const stock = inventoryFor(state, siteId);
  assert.equal(stock.find(m => m.id === materialId(request.items[0].name, request.items[0].unit)).onHand, 10);
  assert.equal(stock.find(m => m.id === materialId(request.items[5].name, request.items[5].unit)).onHand, 23);
  const retry = applyCommand(state, {
    type: 'recordUsageEntry', entryId: usage.id, siteId, reason: usage.reason,
    lines: usage.movementIds.map(id => { const m = state.movements.find(value => value.id === id); return { materialId: materialId(m.itemName, m.unit), quantity: -m.quantity, reason: m.reason }; }),
  }, { actor: usage.actorIdentity, siteIds: [siteId], now: () => new Date().toISOString(), id: () => { throw Error('Retry must not allocate records'); } });
  assert.ok(retry.ok);
  assert.deepEqual(retry.snapshot.movements, state.movements, 'Usage retry does not deduct twice');
  assert.equal(new Set(checkpoints.slice(0, 12).map(item => item.module)).size, 12);
  return {
    ...flow, checkpoints,
    verified: { ...flow.verified, usedSiliconeCartridges: 1, remainingGlassPanels: 10, remainingSiliconeCartridges: 23, groupedUsageEntries: 1, usageRetryIdempotent: true, consumptionRows: rows.length, consumptionReconciles: true, coveredModules: [...new Set(checkpoints.map(item => item.module))] },
  };
}

if (process.argv.includes('--validate-scenario')) {
  const scenario = await capstoneModuleScenarios();
  console.log(JSON.stringify({ figures: scenario.checkpoints.length, commands: scenario.commands.length, verified: scenario.verified }, null, 2));
}
