import { readFile } from 'node:fs/promises';
import { issuanceCheckSql } from './issuance-check.mjs';
export async function paymentCheckSql({ definitionsOnly = false } = {}) {
  const source = await readFile('supabase/checks/payments.sql', 'utf8');
  return await issuanceCheckSql({ definitionsOnly: true }) + (definitionsOnly ? source.split('\ndo $$')[0] : source + '\nrollback;');
}
