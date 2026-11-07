"use server";
import { runPurchasingCommand } from "@/src/server/purchasing/purchasing";
import { runIssuanceCommand } from "@/src/server/purchasing/issuance";
export async function purchasingCommandAction(input: unknown) {
  return runPurchasingCommand(input);
}
export async function issuanceCommandAction(input: unknown) {
  return runIssuanceCommand(input);
}
