import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { verificationSource, requireCurrentEvidence } from './helpers/verification-evidence.mjs';
import { standardAcceptance, databaseAcceptance, acceptanceRequirements } from './helpers/foundation-acceptance.mjs';

const profile = process.argv[2] ?? 'local';
if (!['local', 'standard', 'database', 'milestone', 'demand', 'stock'].includes(profile) || process.argv.length > 3) throw Error('Use local, standard, database, milestone, demand or stock.');
const source = await verificationSource();
const read = path => readFile('.verification/' + path, 'utf8').then(JSON.parse);
await mkdir('.verification', { recursive: true });
let result = { ...source, complete: false, passed: false, scope: profile };
try {
  if (profile === 'database') result = databaseAcceptance(source, await read('database-ci.json'), await read('auth-foundation.json'));
  else if (profile === 'milestone' || profile === 'demand' || profile === 'stock') {
    const local = await read('acceptance-import/local/foundation-acceptance.json');
    requireCurrentEvidence(local, source, 'local');
    if (local.scope !== 'standard' || !local.browserRequired || local.environment.ci) throw Error('Local verification profile missing');
    const evidence = [];
    for (const platform of ['linux', 'win32']) for (const node of ['24.22.1', '26.12.1']) {
      const path = `acceptance-import/${platform}-${node}/foundation-acceptance.json`;
      const report = await read(path);
      requireCurrentEvidence(report, source, path);
      if (report.scope !== 'standard' || !report.environment.ci || report.environment.platform !== platform
        || report.environment.node !== node || (platform === 'win32' && !report.browserRequired)) throw Error('Wrong CI matrix environment: ' + path);
      evidence.push(path);
    }
    const database = await read('acceptance-import/database/foundation-acceptance.json');
    requireCurrentEvidence(database, source, 'database');
    if (database.scope !== 'disposable-foundation' || !database.environment.ci
      || Object.keys(acceptanceRequirements).some(name => database.scenarios?.[name]?.passed !== true)) throw Error('Disposable acceptance incomplete');
    const staging = await read('staging-acceptance.json');
    requireCurrentEvidence(staging, source, 'staging');
    if (staging.projectRef !== 'gxphubtycnvhpgstruqb' || !staging.retainedStateMatches || staging.emailSent !== false) throw Error('Staging parity incomplete');
    if (profile === 'milestone') {
    const drive = await read('document-drive-live.json');
    requireCurrentEvidence(drive, source, 'quotation original live Drive');
    if (!drive.cleaned || !drive.checks?.includes('quotation-mixed-originals') || !drive.checks?.includes('purchasing-comparison-artifacts')) throw Error('Live originals/comparison artifacts/owned cleanup incomplete');
    // Manual review is deliberately explicit, never inferred from green CI.
    const manual = await read('foundation-manual.json');
    requireCurrentEvidence(manual, source, 'targeted manual review');
    if (!manual.confirmedByUser || !manual.reviewedBehavior?.includes('error-retry')) throw Error('Targeted recovery review pending');
    if (!drive.checks?.includes('approved-po-pdf')) throw Error('Approved PO live-Drive verification pending');
    for (const behavior of ['accounting-review-terms-lifecycle', 'accounting-budgets-projects', 'accounting-archives-applicability-access']) {
      if (!manual.reviewedBehavior?.includes(behavior)) throw Error(`Targeted Accounting review pending: ${behavior}`);
    }
    for (const behavior of ['mrf-shared-drafts', 'mrf-conflict-review', 'mrf-revocation', 'mrf-document-sharing', 'mrf-document-recovery', 'project-document-folders', 'mrf-submission-review', 'mrf-approved-archives', 'mrf-corrections-history', 'supplier-sharing-permissions', 'supplier-conflict-recovery', 'supplier-status-history', 'quotation-capture-access', 'quotation-review-conflicts', 'quotation-originals-recovery', 'quotation-financial-finalization', 'quotation-revisions-reconfirmation', 'quotation-revision-archives', 'purchasing-comparisons-artifacts', 'purchasing-awards-po-pricing', 'purchasing-lifecycle-conflicts-access']) {
      if (!manual.reviewedBehavior?.includes(behavior)) throw Error(`Targeted operational review pending: ${behavior}`);
    }
    result = { ...source, complete: true, passed: true, scope: 'milestone', scenarios: database.scenarios,
      evidence: ['acceptance-import/local/foundation-acceptance.json', ...evidence,
        'acceptance-import/database/foundation-acceptance.json', 'staging-acceptance.json', 'document-drive-live.json', 'foundation-manual.json'] };
    } else {
      // Internal 4.6 boundary only. Existing UI/Workflow/browser regressions are
      // still required above; this is not whole-operational/manual acceptance.
      result = { ...source, complete: true, passed: true, scope: profile === 'stock' ? 'internal-stock' : 'internal-demand', scenarios: database.scenarios,
        humanReview: 'Internal foundation only; earlier staff attestations remain historical and unchanged.',
        evidence: ['acceptance-import/local/foundation-acceptance.json', ...evidence,
          'acceptance-import/database/foundation-acceptance.json', 'staging-acceptance.json'] };
    }
  } else {
    const requireBrowser = profile === 'local' || process.platform === 'win32';
    result = standardAcceptance(source, await read('checks.json'), requireBrowser ? await read('browser/verification.json') : null, requireBrowser);
  }
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile('.verification/foundation-acceptance.json', JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2));
}
console.log(`${result.passed ? 'PASS' : 'INCOMPLETE'} foundation acceptance (${profile})${result.error ? ': ' + result.error : ''}`);
