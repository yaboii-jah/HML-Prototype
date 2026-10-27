import { toolchainErrors } from './helpers/toolchain.mjs';

const deployment = process.argv.includes('--deployment')
  || process.env.VERCEL === '1'
  || Boolean(process.env.VERCEL_ENV);
const npmVersion = /^npm\/(\d+\.\d+\.\d+)(?:\s|$)/.exec(process.env.npm_config_user_agent ?? '')?.[1];
const errors = toolchainErrors({ nodeVersion: process.versions.node, npmVersion, deployment });

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Toolchain OK: Node ${process.versions.node}, npm ${npmVersion}${deployment ? ' (Node 24 deployment)' : ''}.`);
}
