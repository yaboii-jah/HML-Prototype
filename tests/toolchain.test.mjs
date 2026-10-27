import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { requiredNpmVersion, toolchainErrors } from '../scripts/helpers/toolchain.mjs';

test('development accepts patched Node 24 and 26 with the declared npm version', () => {
  for (const nodeVersion of ['24.22.1', '24.22.2', '24.23.0', '26.12.1', '26.12.2', '26.13.0']) {
    assert.deepEqual(toolchainErrors({ nodeVersion, npmVersion: requiredNpmVersion }), []);
  }
});

test('unsupported, unpatched and prerelease runtimes fail before verification', () => {
  for (const nodeVersion of ['22.23.4', '24.22.0', '26.12.0', '25.0.0', '27.0.0', '26.12.1-rc.1', undefined]) {
    assert.equal(toolchainErrors({ nodeVersion, npmVersion: requiredNpmVersion }).length, 1);
  }
  for (const npmVersion of ['11.19.0', '12.0.0', undefined]) {
    assert.equal(toolchainErrors({ nodeVersion: '26.12.1', npmVersion }).length, 1);
  }
});

test('deployment requires patched Node 24 even when Node 26 works for development', () => {
  const deployment = { deployment: true, npmVersion: requiredNpmVersion };
  assert.deepEqual(toolchainErrors({ ...deployment, nodeVersion: '24.22.1' }), []);
  assert.deepEqual(toolchainErrors({ ...deployment, nodeVersion: '24.23.0' }), []);
  for (const nodeVersion of ['24.22.0', '26.12.1', '26.13.0']) {
    assert.match(toolchainErrors({ ...deployment, nodeVersion })[0], /Use Node 24/);
  }
});

test('CLI rejects incorrect npm and enforces explicit and Vercel deployment modes', () => {
  function check(args = [], overrides = {}) {
    return spawnSync(process.execPath, ['scripts/check-toolchain.mjs', ...args], {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        VERCEL: '',
        VERCEL_ENV: '',
        npm_config_user_agent: `npm/${requiredNpmVersion} node/v${process.versions.node}`,
        ...overrides,
      },
    });
  }
  const accepted = check();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /Toolchain OK/);
  const incorrectNpm = check([], { npm_config_user_agent: 'npm/12.0.0' });
  assert.equal(incorrectNpm.status, 1);
  assert.match(incorrectNpm.stderr, /Use npm/);

  const expectedDeploymentStatus = process.versions.node.startsWith('24.') ? 0 : 1;
  for (const result of [check(['--deployment']), check([], { VERCEL: '1' }), check([], { VERCEL_ENV: 'preview' })]) {
    assert.equal(result.status, expectedDeploymentStatus, result.stderr);
    if (expectedDeploymentStatus === 1) assert.match(result.stderr, /Use Node 24/);
  }
});
