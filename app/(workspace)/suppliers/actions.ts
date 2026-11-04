"use server";
import { revalidatePath } from "next/cache";
import { runSupplierCommand } from "@/src/server/suppliers/suppliers";

export async function supplierCommandAction(input: unknown) {
  const result = await runSupplierCommand(input);
  revalidatePath("/suppliers", "layout");
  return result;
}
