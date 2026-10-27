import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? '');
  return match?.slice(1).map(Number);
}

// The declared caret ranges admit stable patches/minors within each supported major.
const nodeBaselines = manifest.engines.node.split(' || ').map(range => {
  const version = range.startsWith('^') && parseVersion(range.slice(1));
  if (!version) throw new Error('Declare supported Node baselines as exact caret ranges in package.json.');
  return version;
});
const deploymentBaseline = nodeBaselines.find(version => version[0] === 24);
if (!deploymentBaseline) throw new Error('The supported Node ranges must include the Node 24 deployment baseline.');

export const requiredNpmVersion = /^npm@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager)?.[1];
if (!requiredNpmVersion || manifest.engines.npm !== requiredNpmVersion) {
  throw new Error('packageManager and engines.npm must declare the same exact npm version.');
}

export function nodeVersionError(nodeVersion, { deployment = false } = {}) {
  const actual = parseVersion(nodeVersion);
  const baseline = actual && nodeBaselines.find(version => version[0] === actual[0]);
  const supported = baseline && (
    actual[1] > baseline[1] || (actual[1] === baseline[1] && actual[2] >= baseline[2])
  );
  if (!supported || (deployment && actual[0] !== 24)) {
    const expected = deployment ? `Node 24 (at least ${deploymentBaseline.join('.')})` : `Node ${manifest.engines.node}`;
    return `Use ${expected}; received ${nodeVersion ?? 'an unknown version'}.`;
  }
}

export function toolchainErrors({ nodeVersion, npmVersion, deployment = false }) {
  const errors = [];
  const nodeError = nodeVersionError(nodeVersion, { deployment });
  if (nodeError) errors.push(nodeError);
  if (npmVersion !== requiredNpmVersion) {
    errors.push(`Use npm ${requiredNpmVersion}; received ${npmVersion ?? 'an unknown version'}. Run the check through npm run check:toolchain.`);
  }
  return errors;
}
