'use server';

import { runInventoryCommand, runStockReportCommand } from '@/src/server/inventory/inventory';

export async function inventoryCommandAction(input:unknown) {
  return runInventoryCommand(input);
}

export async function stockReportAction(input:unknown) {
  return runStockReportCommand(input);
}
