import { readFile } from 'node:fs/promises';
import { transferTripCheckSql } from './transfer-trip-check.mjs';

export async function inventoryCheckSql({ definitionsOnly=false }={}) {
  const source=await readFile('supabase/checks/inventory-usage.sql','utf8');
  return await transferTripCheckSql({ definitionsOnly:true })+
    (definitionsOnly?source.split('-- Inventory assertions')[0]:source);
}
