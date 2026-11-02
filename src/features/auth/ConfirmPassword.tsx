"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmPasswordAction } from "@/app/auth/actions";

export function ConfirmPassword({ tokenHash, type }: { tokenHash: string; type: "invite" | "recovery" }) {
  const [state, action, pending] = useActionState(confirmPasswordAction, { error: "" });
  return (
    <main className="state-screen">
      <section className="state-card" aria-labelledby="password-heading">
        <span className="eyebrow">HML CONSTRUCTSYNC</span>
        <h1 id="password-heading">{type === "invite" ? "Set your password" : "Reset your password"}</h1>
        <p>Choose a password, then sign in to your workspace.</p>
        <form action={action} className="signin-form">
          <input name="token_hash" type="hidden" value={tokenHash}/>
          <input name="type" type="hidden" value={type}/>
          <label htmlFor="new-password">New password</label>
          <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required/>
          <label htmlFor="confirm-password">Confirm password</label>
          <input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required/>
          <button className="button primary" disabled={pending}>{pending ? "Saving…" : "Save password"}</button>
          {state.error && <p role="alert">{state.error}</p>}
        </form>
        <Link href="/sign-in">Back to sign in</Link>
      </section>
    </main>
  );
}
