import { requireCurrentEvidence } from './verification-evidence.mjs';

export const standardChecks = ['toolchain', 'lint', 'typegen', 'typecheck', 'unit', 'build'];
export const databaseChecks = ['rollback-sql', 'constraints-auth-data-api', 'types', 'auth-browser-email',
  'supplier-sql', 'supplier-races', 'request-sql', 'request-races', 'mrf-review-sql', 'document-sql', 'document-races', 'project-races', 'account-races', 'realtime-protocol', 'realtime-races'];
export const authChecks = ['supplier-browser', 'sessions', 'captured-email', 'accounts', 'projects', 'realtime-browser', 'shell-loading', 'http-roles-renewal', 'request-browser', 'document-browser-workflow', 'mrf-review-browser-workflow', 'isolation'];
export const acceptanceRequirements = {
  'shared-supplier-directory': ['supplier-sql', 'supplier-races', 'supplier-browser'],
  'mrf-submission-review': ['mrf-review-sql', 'document-races', 'mrf-review-browser-workflow'],
  'required-mrf-documents': ['document-sql', 'document-races', 'document-browser-workflow'],
  'shared-mrf-drafts': ['request-sql', 'request-browser', 'request-races'],
  'invitation-recovery': ['captured-email', 'accounts'],
  'identity-roles': ['sessions', 'accounts', 'http-roles-renewal'],
  'unauthorized-requests': ['sessions', 'constraints-auth-data-api', 'http-roles-renewal'],
  'access-changes': ['accounts', 'realtime-browser', 'realtime-protocol', 'realtime-races', 'http-roles-renewal'],
  'administrator-safeguards': ['accounts', 'account-races'],
  'shared-records-confidentiality': ['projects', 'http-roles-renewal', 'constraints-auth-data-api'],
  'concurrent-allocations-edits': ['projects', 'project-races'],
  'retry-audit-integrity': ['rollback-sql', 'accounts', 'request-sql', 'request-races', 'project-races', 'account-races'],
  'realtime-lifecycle': ['realtime-browser', 'realtime-protocol', 'realtime-races'],
  'temporary-gaps': ['sessions'],
  'environment-isolation': ['isolation'],
  'shell-loading-recovery': ['shell-loading'],
};

function requireChecks(actual, required, label) {
  if (!Array.isArray(actual) || required.some(name => !actual.includes(name))) throw Error(`${label}: required checks did not complete`);
}

export function standardAcceptance(source, standard, browser, requireBrowser) {
  requireCurrentEvidence(standard, source, 'standard checks');
  requireChecks(standard.results?.filter(result => result.code === 0).map(result => result.name), standardChecks, 'standard checks');
  if (standard.results.length !== standardChecks.length || standard.results.some(result => result.code !== 0)) throw Error('Standard results are partial or failed');
  if (requireBrowser) {
    requireCurrentEvidence(browser, source, 'public browser');
    requireChecks(browser.results?.filter(result => result.code === 0 && !result.timedOut).map(result => result.name), ['foundation-public'], 'public browser');
  }
  return { ...source, complete: true, passed: true, scope: 'standard', browserRequired: requireBrowser,
    evidence: ['checks.json', ...(requireBrowser ? ['browser/verification.json'] : [])] };
}

export function databaseAcceptance(source, database, auth) {
  requireCurrentEvidence(database, source, 'disposable database');
  requireCurrentEvidence(auth, source, 'authenticated browser');
  requireChecks(database.checks, databaseChecks, 'database');
  requireChecks(auth.checks, authChecks, 'authenticated browser');
  if (!database.cleaned || !database.typeMatch || !auth.cleaned || !auth.isolated) throw Error('Owned resources/type/isolation checks incomplete');
  const completed = [...database.checks, ...auth.checks];
  return { ...source, complete: true, passed: true, scope: 'disposable-foundation',
    scenarios: Object.fromEntries(Object.entries(acceptanceRequirements).map(([name, checks]) => [name, {
      passed: checks.every(check => completed.includes(check)), checks,
      evidence: ['database-ci.json', 'auth-foundation.json'],
    }])) };
}
