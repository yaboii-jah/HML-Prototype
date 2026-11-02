export const STAGING_REF = 'gxphubtycnvhpgstruqb';
export const PRODUCTION_REF = 'caiasmpfhueuouxqhalo';
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

export function requireStaging(environment) {
  if (environment.SUPABASE_PROJECT_REF !== STAGING_REF) {
    throw new Error('SUPABASE_PROJECT_REF must explicitly select ConstructSync staging.');
  }
  if (environment.NEXT_PUBLIC_SUPABASE_URL && environment.NEXT_PUBLIC_SUPABASE_URL !== STAGING_URL) {
    throw new Error('The application URL must match ConstructSync staging.');
  }
  // Avoid alternate CLI targets inherited from another project/session.
  for (const key of ['SUPABASE_DB_URL', 'DATABASE_URL', 'SUPABASE_CLI_BINARY_OVERRIDE']) {
    if (environment[key]) throw new Error(`${key} must be unset for staging tooling.`);
  }
  if (!environment.SUPABASE_ACCESS_TOKEN) {
    throw new Error('Set a SUPABASE_ACCESS_TOKEN authorized for ConstructSync staging; the global CLI login is not used.');
  }
  return STAGING_REF;
}

export function requireLoopback(value) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !['http:', 'https:', 'postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error('Disposable database checks require loopback URLs.');
  }
  return url;
}
