"use server";
import { runAccountingCommand } from "@/src/server/purchasing/accounting";

export async function accountingCommandAction(input: unknown) {
  return runAccountingCommand(input);
}
