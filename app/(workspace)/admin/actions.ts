"use server";

import { revalidatePath } from "next/cache";
import { runAccountCommand } from "@/src/server/accounts/accounts";

export async function accountCommandAction(input: unknown) {
  const result = await runAccountCommand(input);
  // Also refresh after partial failure: provisioning or dispatch may have saved.
  revalidatePath("/admin");
  return result;
}
