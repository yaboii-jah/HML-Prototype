import { spawnSync } from 'node:child_process';
import { nodeVersionError, requiredNpmVersion } from './helpers/toolchain.mjs';

const nodeError = nodeVersionError(process.versions.node, { deployment: true });
if (nodeError) {
  console.error(nodeError);
  process.exit(1);
}

// Vercel runs this bootstrap on Linux before project dependencies exist.
// Read the npm pin from package.json rather than relying on the build image default.
for (const args of [['install', '--global', `npm@${requiredNpmVersion}`], ['ci']]) {
  const result = spawnSync('npm', args, { stdio: 'inherit', shell: false });
  if (result.error) {
    console.error(`Could not start npm: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
