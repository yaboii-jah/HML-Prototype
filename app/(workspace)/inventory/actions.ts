'use server';

import { runInventoryCommand } from '@/src/server/inventory/inventory';

export async function inventoryCommandAction(input:unknown) {
  return runInventoryCommand(input);
}
