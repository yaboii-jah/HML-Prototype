"use server";
import { runPaymentCommand } from "@/src/server/payments/payments";
export async function paymentCommandAction(input: unknown) {
  return runPaymentCommand(input);
}
