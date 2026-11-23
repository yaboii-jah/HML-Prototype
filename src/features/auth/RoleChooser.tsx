"use client";

import { useActionState } from "react";
import { selectRoleAction } from "@/app/auth/actions";
import { SignOutForm } from "./SignOutForm";
import type { SessionContext } from "@/src/domain/auth/session";

export function RoleChooser({ session }: { session: SessionContext }) {
  const [state, action, pending] = useActionState(selectRoleAction, { error: "" });
  return (
    <main className="state-screen">
      <section className="state-card" aria-labelledby="role-heading">
        <span className="eyebrow">HML CONSTRUCTSYNC</span>
        <h1 id="role-heading">Choose your role</h1>
        <p>Signed in as {session.displayName}. Choose how you want to work.</p>
        <form action={action} className="signin-form">
          <label htmlFor="active-role">Role</label>
          <select id="active-role" name="role" required defaultValue="">
            <option value="" disabled>Select a role</option>
            {session.roles.map(role => <option key={role}>{role}</option>)}
          </select>
          <button className="button primary" disabled={pending}>{pending ? "Opening workspace…" : "Continue"}</button>
          {state.error && <p role="alert">{state.error}</p>}
        </form>
        <SignOutForm/>
      </section>
    </main>
  );
}
