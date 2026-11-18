import { readFile } from 'node:fs/promises';
import { deliveryCheckSql } from './delivery-check.mjs';

export async function transferCheckSql({ definitionsOnly=false }={}) {
  const source=await readFile('supabase/checks/transfer-approval.sql','utf8');
  return await deliveryCheckSql({ definitionsOnly:true })+(definitionsOnly?source.split('-- Transfer assertions')[0]:source);
}
