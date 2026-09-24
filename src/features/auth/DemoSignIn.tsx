"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/src/app-state/demo-session";

const WORKFLOW_STAGES = [
  { name: "Request", title: "Start with a clear request.", description: "Capture the materials a site needs and keep the handoff visible to everyone involved.", card: "Material request", detail: "Ready for review" },
  { name: "Review", title: "Keep decisions moving.", description: "Project managers can review what is needed before purchasing begins.", card: "Manager review", detail: "Decision in one place" },
  { name: "Procure", title: "Turn approval into action.", description: "Compare quotations and prepare purchase orders without losing the request trail.", card: "Procurement", detail: "From quote to order" },
  { name: "Receive", title: "Close the loop on site.", description: "Record deliveries, confirm quantities, and make received materials visible in site stock.", card: "Site receiving", detail: "Stock stays in sync" },
] as const;

function destinationAfterSignIn() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /^\/sign-in(?:\/|$|\?)/.test(next)) return "/dashboard";
  return next;
}

export function DemoSignIn() {
  const { snapshot, status, message, session, signIn, reset } = useDemo();
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
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const rolePickerRef = useRef<HTMLDivElement>(null);
  const roleTriggerRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (!rolePickerOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rolePickerRef.current?.contains(event.target as Node)) setRolePickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRolePickerOpen(false);
        roleTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [rolePickerOpen]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await signIn(email, password);
    if (result.ok) router.replace(destinationAfterSignIn());
    else setError(result.message);
    setBusy(false);
  };

  if (status === "loading" || session.status === "loading") return <div className="state-screen"><div className="state-card"><span className="eyebrow">HML ConstructSync</span><h1>Opening demo sign-in</h1><p>Preparing sample accounts…</p></div></div>;
  if (status === "recovery" || !snapshot) return <div className="state-screen"><div className="state-card"><span className="eyebrow">WORKSPACE RECOVERY</span><h1>Saved data needs attention</h1><p>{message}</p><button className="button primary" onClick={() => { if (window.confirm("Restore the workspace? Current saved records will be replaced.")) void reset(); }}>Restore workspace</button></div></div>;

  const stage = WORKFLOW_STAGES[stageIndex];
  const playbackPaused = manualPaused || reducedMotion;
  const selectedAccount = DEMO_ACCOUNTS.find(account => account.email === email);
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
      <p className="signin-intro-foot">A guided look at the project flow <span>·</span> Prototype data stays in this browser</p>
    </section>

    <section className="signin-panel" aria-labelledby="signin-title">
      <div className="signin-card">
        <div className="signin-card-head"><span className="signin-card-symbol" aria-hidden="true">H</span><span>HML ConstructSync</span></div>
        <h2 id="signin-title">Sign in to explore</h2>
        <p>Choose a sample account, then open its work queue and role-specific actions.</p>
        <div className="signin-role-picker" ref={rolePickerRef} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setRolePickerOpen(false); }}>
          <span className="signin-role-label">Demo role</span>
          <button ref={roleTriggerRef} className="signin-role-trigger" type="button" aria-expanded={rolePickerOpen} aria-controls="signin-role-options" onClick={() => setRolePickerOpen(open => !open)}>
            <span><strong>{selectedAccount?.role ?? "Choose a demo role"}</strong>{selectedAccount && <small>{selectedAccount.email}</small>}</span>
            <span className="signin-role-chevron" aria-hidden="true">⌄</span>
          </button>
          {rolePickerOpen && <div id="signin-role-options" className="signin-role-options" role="group" aria-label="Choose a demo role">
            {DEMO_ACCOUNTS.map(account => <button key={account.role} type="button" className={email === account.email ? "selected" : ""} onClick={() => { setEmail(account.email); setPassword(DEMO_PASSWORD); setError(""); setRolePickerOpen(false); roleTriggerRef.current?.focus(); }} aria-label={`Fill ${account.role} demo credentials`}><span>{account.role}</span><small>{account.email}</small></button>)}
          </div>}
        </div>
        <form className="signin-form" onSubmit={event => void submit(event)}>
          <div className="signin-field"><label htmlFor="demo-email">Sample email</label><input id="demo-email" name="email" type="email" autoComplete="username" required value={email} onChange={event => { setEmail(event.target.value); setError(""); }} placeholder="site@constructsync.example" aria-invalid={Boolean(error)} aria-describedby={error ? "signin-error" : undefined} /></div>
          <div className="signin-field"><label htmlFor="demo-password">Demo password</label><input id="demo-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={event => { setPassword(event.target.value); setError(""); }} placeholder="Enter the demo password" aria-invalid={Boolean(error)} aria-describedby={error ? "signin-error" : undefined} /></div>
          <button className="button primary signin-submit" disabled={busy}>{busy ? "Opening workspace…" : "Sign in"}</button>
        </form>
        {error ? <p id="signin-error" className="signin-error" role="alert">{error}</p> : <p className="signin-note">Shared demo password: <code>{DEMO_PASSWORD}</code>. Accounts and permissions are simulated in this browser.</p>}
        {status === "volatile" && <p className="signin-warning" role="status">{message} Your demo role will be lost on refresh.</p>}
      </div>
    </section>
  </main>;
}
