import { readFile } from 'node:fs/promises';
import { transferCheckSql } from './transfer-check.mjs';

export async function transferTripCheckSql({ definitionsOnly=false }={}) {
  const source=await readFile('supabase/checks/transfer-trip-dispatch.sql','utf8');
  return await transferCheckSql({ definitionsOnly:true })+(definitionsOnly?source.split('-- Trip assertions')[0]:source);
}
