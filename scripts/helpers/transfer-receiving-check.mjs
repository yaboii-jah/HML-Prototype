import { readFile } from 'node:fs/promises';
import { transferTripCheckSql } from './transfer-trip-check.mjs';

export async function transferReceivingCheckSql({ definitionsOnly = false } = {}) {
  const source = await readFile('supabase/checks/transfer-receiving.sql','utf8');
  return await transferTripCheckSql({ definitionsOnly:true }) + (definitionsOnly ? source.split('-- Receipt assertions')[0] : source);
}
