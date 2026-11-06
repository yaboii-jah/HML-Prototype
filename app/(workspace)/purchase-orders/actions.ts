"use server";
import { runPurchasingCommand } from "@/src/server/purchasing/purchasing";
export async function purchasingCommandAction(input: unknown) {
  return runPurchasingCommand(input);
}
