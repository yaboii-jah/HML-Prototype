import { readFile } from 'node:fs/promises';

/** Share the rollback fixture definitions; every caller owns its transaction. */
export async function accountingCheckSql({ definitionsOnly = false } = {}) {
  const purchasing = (await readFile('supabase/checks/purchasing.sql', 'utf8')).split('-- Assertions (the concurrency runner')[0];
  const accounting = await readFile('supabase/checks/accounting.sql', 'utf8');
  return purchasing + (definitionsOnly ? accounting.split('-- Accounting assertions')[0] : accounting);
}
