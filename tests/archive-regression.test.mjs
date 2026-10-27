import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo } from './fixtures/workspace.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { archiveBidWorkbook } from '../src/features/requests/bid-report-files.ts';
import { documentDigest as workbookDigest } from '../src/documents/digest.ts';
import { generateBidWorkbook } from '../src/server/bid-workbook.ts';

test('an acknowledged spreadsheet archive completes and retry preserves its identity', async () => {
  let state = seedDemo();
  state.role = 'Procurement'; state.pos = [];
  state.sites[0].driveFolderId = 'bid-project-folder';
  for (const quote of state.quotes) quote.financial = { vatStatus: 'VAT', priceBasis: 'exclusive', vatRate: 12, reviewed: true };
  const run = async command => {
    const result = applyCommand(state, command);
    if (result.ok) state = result.snapshot;
    return result;
  };
  assert.equal((await run({ type: 'createBidReport', requestId: 'm1' })).ok, true);
  const report = state.bidReports[0];
  const blob = new Blob([await generateBidWorkbook(report)]);
  const sha256 = await workbookDigest(blob);
  assert.equal((await run({ type: 'saveBidReportFile', id: report.id, localFileId: 'file', sha256 })).ok, true);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ driveFileId: 'drive-file', url: 'https://docs.google.com/spreadsheets/d/drive-file/edit?usp=drivesdk' }); };
  try {
    await archiveBidWorkbook(state.bidReports[0], blob, run);
    assert.equal(state.bidReports[0].archive.status, 'complete');
    assert.equal(state.bidReports[0].sha256, sha256);
    assert.equal(state.bidReports[0].archive.error, undefined);
    await archiveBidWorkbook(state.bidReports[0], blob, run);
    assert.equal(calls, 1);
    for (const url of ['https://docs.google.com.evil.test/spreadsheets/d/drive-file/edit', 'http://drive.google.com/file/d/drive-file/view', 'https://drive.google.com/file/d/other-file/view']) {
      const pending = structuredClone(state); pending.bidReports[0].archive = { status: 'pending' };
      assert.equal(applyCommand(pending, { type: 'completeBidArchive', id: report.id, fileId: 'drive-file', url }).ok, false);
    }
  } finally { globalThis.fetch = originalFetch; }
});
