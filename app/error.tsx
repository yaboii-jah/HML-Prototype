"use client";

import Link from "next/link";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <main className="state-screen">
      <section className="state-card">
        <h1>Workspace unavailable</h1>
        <p>The workspace could not be opened. Check your connection and try again.</p>
        <button className="button primary" onClick={retry}>Try again</button>
        <Link className="button secondary" href="/sign-in">Back to sign in</Link>
      </section>
    </main>
  );
}
