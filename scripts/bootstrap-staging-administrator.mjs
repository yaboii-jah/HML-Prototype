import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { STAGING_REF, STAGING_URL } from './helpers/supabase-target.mjs';
import { bootstrapAdministrator } from './helpers/bootstrap-administrator.mjs';

if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in a private interactive terminal without arguments.');
if (process.env.SUPABASE_PROJECT_REF !== STAGING_REF || process.env.NEXT_PUBLIC_SUPABASE_URL !== STAGING_URL || !process.env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) {
  throw new Error('Explicit staging configuration and its server-only SUPABASE_SECRET_KEY are required.');
}
if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) throw new Error('Unset alternate database targets.');
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
const prompt = createInterface({ input: process.stdin, output, terminal: true });
const secret = async label => {
  process.stdout.write(label);
  muted = true;
  try { return await prompt.question(''); }
  finally { muted = false; process.stdout.write('\n'); }
};
try {
  const name = (await prompt.question('Administrator name: ')).trim();
  const email = (await prompt.question('Administrator email: ')).trim();
  const password = await secret('Password (hidden, 8–128 characters): ');
  if (password !== await secret('Confirm password (hidden): ')) throw new Error('Passwords do not match.');
  const checkpointFile = 'supabase/.temp/administrator-bootstrap.json';
  await mkdir('supabase/.temp', { recursive: true });
  const client = createClient(STAGING_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
  });
  await bootstrapAdministrator({ client, name, email, password,
    load: async () => { try { return JSON.parse(await readFile(checkpointFile, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('The private bootstrap checkpoint could not be read.'); } },
    save: async checkpoint => {
      await writeFile(checkpointFile + '.tmp', JSON.stringify(checkpoint), { mode: 0o600 });
      await rename(checkpointFile + '.tmp', checkpointFile);
    },
  });
  console.log('First Administrator is ready. Sign in at http://127.0.0.1:3000/sign-in.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Administrator setup failed.');
  process.exitCode = 1;
} finally { prompt.close(); }
