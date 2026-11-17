import { readFile } from 'node:fs/promises';
import { paymentCheckSql } from './payment-check.mjs';
export async function deliveryCheckSql({ definitionsOnly = false } = {}) {
  const source = await readFile('supabase/checks/deliveries.sql', 'utf8');
  return await paymentCheckSql({ definitionsOnly:true }) + (definitionsOnly ? source.split('-- Delivery assertions')[0] : source);
}
