"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";

const WORKFLOW_STAGES = [
  { name: "Request", title: "Start with a clear request.", description: "Capture the materials a site needs and keep the handoff visible to everyone involved.", card: "Material request", detail: "Ready for review" },
  { name: "Review", title: "Keep decisions moving.", description: "Project Manager reviews material requests and keeps each approval linked to the site.", card: "Project Manager review", detail: "Decision in one place" },
  { name: "Procure", title: "Turn approval into action.", description: "Compare quotations and prepare purchase orders without losing the request trail.", card: "Procurement", detail: "From quote to order" },
  { name: "Receive", title: "Close the loop on site.", description: "Record deliveries, confirm quantities, and make received materials visible in site stock.", card: "Site receiving", detail: "Stock stays in sync" },
] as const;

function destinationAfterSignIn() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /^\/sign-in(?:\/|$|\?)/.test(next)) return "/dashboard";
  return next;
}

export function DemoSignIn() {
  const { confirm, confirmation } = useConfirmation();
  const { snapshot, status, message, session, directory, signIn, reset } = useDemo();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [manualPaused, setManualPaused] = useState(false);
  const [playRequested, setPlayRequested] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (session.role && snapshot?.role === session.role) router.replace(destinationAfterSignIn());
  }, [router, session.role, snapshot?.role]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);
    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (manualPaused || reducedMotion || (!playRequested && (hovered || focused))) return;
    const timer = window.setInterval(() => setStageIndex(index => (index + 1) % WORKFLOW_STAGES.length), 6500);
    return () => window.clearInterval(timer);
  }, [manualPaused, playRequested, hovered, focused, reducedMotion]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await signIn(email, password);
      if (result.ok && status !== "recovery") router.replace(destinationAfterSignIn());
      else if (result.ok) setPassword("");
      else setError(result.message);
    } catch { setError("Sign-in could not finish. Please try again."); }
    finally { setBusy(false); }
  };

  if (status === "loading" || session.status === "loading") return <div className="state-screen"><div className="state-card"><span className="eyebrow">HML ConstructSync</span><h1>Opening sign-in</h1><p>Preparing your workspace…</p></div></div>;
  if (directory.status === "recovery") return <div className="state-screen"><div className="state-card"><h1>Saved user accounts need attention</h1><p>{directory.error}</p><p>Restore the saved user directory in browser storage before continuing.</p></div></div>;
  if (status === "recovery" || !snapshot) return <><div className="state-screen"><div className="state-card"><span className="eyebrow">WORKSPACE RECOVERY</span><h1>Saved data needs attention</h1><p>{message}</p>{session.role === "Administrator" ? <button className="button primary" onClick={() => void (async () => { if (await confirm("Restore this workspace?", "Saved operational records and uploaded files will be removed. User accounts and their management history are preserved.", "Restore workspace", true)) await reset(); })()}>Restore workspace</button> : <form className="signin-form" onSubmit={event => void submit(event)}><p>Sign in as Administrator to restore the workspace.</p><label>Email<input type="email" required value={email} onChange={event => setEmail(event.target.value)} autoComplete="username"/></label><label>Password<input type="password" required value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password"/></label><button className="button primary" disabled={busy}>Verify Administrator</button>{error && <p role="alert">{error}</p>}</form>}</div></div>{confirmation}</>;


  const stage = WORKFLOW_STAGES[stageIndex];
  const playbackPaused = manualPaused || reducedMotion;
  const togglePlayback = () => {
    if (manualPaused) {
      setManualPaused(false);
      setPlayRequested(true);
      setStageIndex(index => (index + 1) % WORKFLOW_STAGES.length);
    } else {
      setManualPaused(true);
      setPlayRequested(false);
    }
  };

  return <main className="signin-page">
    <section className="signin-intro" aria-label="ConstructSync introduction" onMouseEnter={() => { setHovered(true); setPlayRequested(false); }} onMouseLeave={() => setHovered(false)} onFocusCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPlayRequested(false); setFocused(true); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <div className="signin-logo"><Image src="/company%20-%20logo.webp" alt="HML Technologies and Services Inc." width={190} height={45} priority /></div>
      <div className="signin-story">
        <div className="signin-intro-copy" key={stage.name}>
          <span className="signin-kicker">HML CONSTRUCTSYNC <span aria-hidden="true">/ 0{stageIndex + 1}</span></span>
          <h1>{stage.title}</h1>
          <p>{stage.description}</p>
        </div>
        <div className="signin-workflow" aria-hidden="true">
          <div className="signin-workflow-top"><span>Project handoff</span><span>01—04</span></div>
          <div className="signin-workflow-path">
            {WORKFLOW_STAGES.map((item, index) => <div className={`signin-workflow-node${index === stageIndex ? " active" : ""}${index < stageIndex ? " complete" : ""}`} key={item.name}><span className="signin-workflow-dot" /><span>{item.name}</span></div>)}
          </div>
          <div className="signin-workflow-card" key={stage.name}>
            <span className="signin-workflow-card-mark">0{stageIndex + 1}</span>
            <div><strong>{stage.card}</strong><small>{stage.detail}</small></div>
            <span className="signin-workflow-card-arrow">↗</span>
          </div>
        </div>
        <div className="signin-story-controls" aria-label="Workflow stories">
          <div className="signin-story-stages">{WORKFLOW_STAGES.map((item, index) => <button key={item.name} type="button" className={index === stageIndex ? "active" : ""} aria-label={`Show ${item.name} story`} aria-pressed={index === stageIndex} onClick={() => { setStageIndex(index); setPlayRequested(false); }}><span>{item.name}</span></button>)}</div>
          <button className="signin-story-playback" type="button" aria-label={playbackPaused ? "Play workflow stories" : "Pause workflow stories"} onClick={togglePlayback} disabled={reducedMotion} title={reducedMotion ? "Automatic motion is off in reduced-motion mode" : undefined}>{playbackPaused ? "Play" : "Pause"}</button>
        </div>
      </div>
      <p className="signin-intro-foot">From material request to site delivery</p>
    </section>

    <section className="signin-panel" aria-labelledby="signin-title">
      <div className="signin-card">
        <div className="signin-card-head"><span className="signin-card-symbol" aria-hidden="true">H</span><span>HML ConstructSync</span></div>
        <h2 id="signin-title">Sign in to your workspace</h2>
        <p>Manage requests, purchases and deliveries.</p>
        <form className="signin-form" onSubmit={event => void submit(event)}>
          <div className="signin-field"><label htmlFor="signin-email">Email</label><input id="signin-email" name="email" type="email" autoComplete="username" required value={email} onChange={event => { setEmail(event.target.value); setError(""); }} placeholder="Enter your email" aria-invalid={Boolean(error)} aria-describedby={error ? "signin-error" : undefined} /></div>
          <div className="signin-field"><label htmlFor="signin-password">Password</label><input id="signin-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={event => { setPassword(event.target.value); setError(""); }} placeholder="Enter your password" aria-invalid={Boolean(error)} aria-describedby={error ? "signin-error" : undefined} /></div>
          <button className="button primary signin-submit" disabled={busy}>{busy ? "Opening workspace…" : "Sign in"}</button>
        </form>
        {error && <p id="signin-error" className="signin-error" role="alert">{error}</p>}
        {(status === "volatile" || session.status === "volatile") && <p className="signin-warning" role="status">Your session could not be saved. Sign in again after refreshing.</p>}
      </div>
    </section>
  </main>;
}
