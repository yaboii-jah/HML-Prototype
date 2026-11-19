import { readFile } from 'node:fs/promises';
import { transferReceivingCheckSql } from './transfer-receiving-check.mjs';

export async function monitoringCheckSql({ definitionsOnly = false } = {}) {
  const source = await readFile('supabase/checks/operational-monitoring.sql', 'utf8');
  return await transferReceivingCheckSql({ definitionsOnly: true }) +
    (definitionsOnly ? source.split('-- Monitoring assertions')[0] : source);
}
