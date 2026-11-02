import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { migrationHash } from './database-migrations.mjs';

export function canonicalSourceBytes(path, contents) {
  const textFile = /\.(?:[cm]?[jt]sx?|json|sql|toml|css|html|xml|ya?ml|md|svg|txt|ps1|sh|py)$/.test(path)
    || ['.npmrc', '.node-version', '.env.example', 'supabase/.gitignore'].includes(path);
  return textFile ? contents.toString('utf8').replaceAll('\r\n', '\n') : contents;
}

// Excludes private configuration, generated outputs and unrelated agent tooling.
// Normalize checkout line endings so Linux and Windows produce the same digest.
export async function verificationSource() {
  if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8', windowsHide: true }).trim() === 'true') {
    throw Error('Acceptance provenance requires full Git history; configure checkout with fetch-depth: 0.');
  }
  const sourcePaths = [
    'app', 'src', 'scripts', 'tests', 'supabase', 'public', '.github/workflows', 'package.json', 'package-lock.json',
    'proxy.ts', 'middleware.ts', 'vercel.json', '.node-version', '.npmrc', '.env.example',
    'next.config.*', 'tsconfig.json', 'eslint.config.*', 'postcss.config.*'];
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...sourcePaths], { encoding: 'utf8', windowsHide: true })
    .split('\0').filter(Boolean);
  const hash = createHash('sha256');
  for (const path of [...new Set(paths)].sort()) {
    hash.update(path + '\0');
    try {
      const contents = await readFile(path);
      hash.update(canonicalSourceBytes(path, contents));
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('<deleted>'); }
    hash.update('\0');
  }
  const migrations = [];
  for (const name of (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort()) {
    migrations.push({ name, sql: await readFile('supabase/migrations/' + name, 'utf8') });
  }
  return {
    // A documentation-only checkpoint does not change the tested implementation.
    sourceRevision: execFileSync('git', ['log', '-1', '--format=%H', '--', ...sourcePaths], { encoding: 'utf8', windowsHide: true }).trim(),
    checkoutRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
    sourceHash: hash.digest('hex'), migrationHash: migrationHash(migrations),
    environment: { platform: process.platform, node: process.versions.node, ci: process.env.GITHUB_ACTIONS === 'true' },
    ...(process.env.GITHUB_RUN_ID ? { runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` } : {}),
  };
}

export function requireCurrentEvidence(evidence, source, label) {
  if (evidence?.passed !== true || evidence.complete !== true
    || evidence.sourceHash !== source.sourceHash || evidence.migrationHash !== source.migrationHash
    || evidence.sourceRevision !== source.sourceRevision) {
    throw Error(`${label}: missing, failed, incomplete or stale evidence`);
  }
}
