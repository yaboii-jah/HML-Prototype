"use client";

import { createClient } from "@supabase/supabase-js";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { object } from "@/src/domain/accounts/accounts";
import type { WorkspaceSession } from "@/src/domain/auth/session";
import { foundationViewQuery, parseFoundationView, parseRealtimeSession, parseWorkspaceSession, type FoundationView } from "@/src/domain/realtime/foundation";

type LiveContext = { view: FoundationView | null; session: WorkspaceSession | null; refresh: () => void };
const Context = createContext<LiveContext>({ view: null, session: null, refresh: () => {} });
export function useFoundationRealtime() { return useContext(Context); }

export function FoundationRealtime({ session, children }: { session: WorkspaceSession; children: ReactNode }) {
  const pathname = usePathname();
  const [savedView, setView] = useState<{ path: string; data: FoundationView } | null>(null);
  const [status, setStatus] = useState("Connecting live updates…");
  const [removed, setRemoved] = useState(false);
  const [latestSession, setSession] = useState(session);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    let stopped = false, busy = false, again = false, connected = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let client: ReturnType<typeof createClient> | undefined;
    let topic = "", token = "";
    const abort = new AbortController();
    const query = foundationViewQuery(pathname) ?? "view=session";
    const terminate = (destination: string) => {
      stopped = true;
      abort.abort();
      setView(null);
      setRemoved(true);
      void client?.removeAllChannels();
      client?.realtime.disconnect();
      window.location.replace(destination);
    };
    const checkIdentity = (latest: WorkspaceSession) => {
      if (latest.userId !== session.userId || latest.revision !== session.revision) {
        terminate("/sign-in");
        return false;
      }
      if (latest.activeRole !== session.activeRole) {
        terminate("/projects");
        return false;
      }
      return true;
    };
    const get = async (url: string) => {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]) });
      if (stopped) return null;
      if (response.status === 401) { terminate("/sign-in"); return null; }
      if (response.status === 409) { terminate("/choose-role"); return null; }
      if (!response.ok) throw Error("Read unavailable");
      return response.json() as Promise<unknown>;
    };
    const schedule = () => {
      if (stopped || document.visibilityState === "hidden") return;
      if (busy) { again = true; return; }
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void read(), 250);
    };
    const read = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        const bootstrap = await get("/api/realtime/session");
        if (stopped) return;
        const credentials = parseRealtimeSession(bootstrap);
        if (!credentials || !checkIdentity(credentials.session)) throw Error("Invalid live session");
        const tokenChanged = token !== credentials.accessToken;
        token = credentials.accessToken;
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
        if (url && key && !client) {
          // Realtime invokes this callback again on heartbeat/rejoin. An empty
          // browser Auth store must never replace the server-issued credential.
          client = createClient(url, key, { accessToken: async () => token || null });
        }
        if (client) {
          if (tokenChanged) {
            await client.realtime.setAuth(token);
            if (stopped) return;
          }
          if (topic !== credentials.topic) {
            topic = credentials.topic;
            await client.removeAllChannels();
            if (stopped) return;
            client.channel(topic, { config: { private: true, broadcast: { replication_ready: true } } })
              .on("broadcast", { event: "foundation_changed" }, schedule)
              .on("broadcast", { event: "access_changed" }, schedule)
              .on("system", {}, (message) => {
                if (stopped) return;
                connected = message.status === "ok";
                if (connected) schedule();
                else setStatus("Live updates unavailable. Checking every 30 seconds.");
              })
              .subscribe((state) => {
                if (stopped) return;
                connected = state === "SUBSCRIBED";
                setStatus(connected ? "" : "Live updates reconnecting. Checking every 30 seconds.");
                if (connected) schedule();
              });
          }
        }
        const raw = object(await get("/api/foundation/view?" + query));
        if (stopped) return;
        const latest = parseWorkspaceSession(raw?.session);
        if (!latest || !checkIdentity(latest)) throw Error("Invalid session");
        setSession(latest);
        if (query !== "view=session") {
          const next = parseFoundationView(raw?.view);
          if (!next) throw Error("Invalid view");
          setView({ path: pathname, data: next });
        }
        setStatus(connected ? "" : "Live updates reconnecting. Checking every 30 seconds.");
      } catch {
        if (!stopped) setStatus("Updates could not be checked. This view may be stale. Retry.");
      } finally {
        busy = false;
        if (again && !stopped) { again = false; schedule(); }
      }
    };
    refreshRef.current = schedule;
    const foreground = () => schedule();
    const interval = setInterval(() => void read(), 30000);
    window.addEventListener("focus", foreground);
    window.addEventListener("online", foreground);
    window.addEventListener("pageshow", foreground);
    document.addEventListener("visibilitychange", foreground);
    void read();
    return () => {
      stopped = true;
      abort.abort();
      refreshRef.current = () => {};
      clearInterval(interval);
      clearTimeout(retryTimer);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("online", foreground);
      window.removeEventListener("pageshow", foreground);
      document.removeEventListener("visibilitychange", foreground);
      void client?.removeAllChannels();
      client?.realtime.disconnect();
      token = "";
    };
  }, [pathname, session.userId, session.revision, session.activeRole]);

  if (removed) return <p role="status">Your session changed. Returning to sign-in…</p>;
  return <Context.Provider value={{ view: savedView?.path === pathname ? savedView.data : null, session: latestSession, refresh }}>
    {status && <div className="foundation-status" role="status"><span>{status}</span>
      <button type="button" className="button secondary" onClick={refresh}>Refresh / Retry</button></div>}
    {children}
  </Context.Provider>;
}
