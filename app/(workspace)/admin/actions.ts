"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearAuthCookies } from "@/src/server/auth/clients";
import { runAccountCommand } from "@/src/server/accounts/accounts";

export async function accountCommandAction(input: unknown) {
  const result = await runAccountCommand(input);
  if (result.signInRequired) {
    await clearAuthCookies();
    redirect("/sign-in");
  }
  // Also refresh after partial failure: provisioning or dispatch may have saved.
  revalidatePath("/admin");
  return result;
}
