"use client";

import { useActionState } from "react";
import { signOutAction } from "@/app/auth/actions";

export function SignOutForm() {
  const [state, action, pending] = useActionState(signOutAction, { error: "" });
  return (
    <form action={action} className="account-modal-actions">
      <button className="button secondary" disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
