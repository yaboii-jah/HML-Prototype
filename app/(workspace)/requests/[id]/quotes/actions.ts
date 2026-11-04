"use server";
import { revalidatePath } from "next/cache";
import { runQuotationCommand } from "@/src/server/quotations/drafts";

export async function quotationCommandAction(input: unknown) {
  const result = await runQuotationCommand(input);
  revalidatePath("/requests", "layout");
  return result;
}
