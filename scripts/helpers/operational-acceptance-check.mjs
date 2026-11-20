import { readFile } from 'node:fs/promises';
import { monitoringCheckSql } from './monitoring-check.mjs';

export async function operationalAcceptanceSql({ definitionsOnly = false } = {}) {
  const source = await readFile('supabase/checks/operational-acceptance.sql', 'utf8');
  return await monitoringCheckSql({ definitionsOnly: true }) +
    (definitionsOnly ? source.split('-- Operational acceptance assertions')[0] : source);
}
