'use server';
import { runTransferCommand } from '@/src/server/transfers/transfers';

export async function transferCommandAction(input:unknown) {
  return runTransferCommand(input);
}
