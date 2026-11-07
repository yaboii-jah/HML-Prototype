import { readFile } from 'node:fs/promises';
import { accountingCheckSql } from './accounting-check.mjs';

export async function issuanceCheckSql({ definitionsOnly = false } = {}) {
  const source = await readFile('supabase/checks/issuance.sql', 'utf8');
  return await accountingCheckSql({ definitionsOnly: true })
    + (definitionsOnly ? source.split('-- Issuance assertions')[0] : source);
}
