import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export function supabase(args, { capture = false, environment = process.env } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), ...args], {
      env: environment,
      windowsHide: true,
      stdio: ['ignore', capture ? 'pipe' : 'inherit', 'pipe'],
    });
    let output = '';
    let error = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      // CLI diagnostics can include connection strings; do not relay them to application/CI logs.
      if (code !== 0) {
        const safeError = error.replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, '[database URL]')
          .replace(/(?:sb_secret_|sb_publishable_|sbp_)[\w-]+/g, '[key]')
          .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]');
        reject(new Error(`Supabase ${args.slice(0, 2).join(' ')} failed (exit ${code}). ${safeError.slice(-2400)}`));
      }
      else resolveResult({ output, diagnostics: error });
    });
  });
}
