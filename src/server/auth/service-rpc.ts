import "server-only";
import { publicAuthConfiguration } from "./config";

export class ServiceCommandError extends Error {
  constructor(public readonly code: string) { super("The database command could not complete."); }
}

/** JSON RPC transport. JSON results are validated at each module boundary. */
export async function serviceRpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
  const config = publicAuthConfiguration(), secret = process.env.SUPABASE_SECRET_KEY;
  if (!config || !secret) throw new ServiceCommandError("unavailable");
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(parameters), cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const code = body && typeof body === "object" && "code" in body ? String(body.code) : "unavailable";
    throw new ServiceCommandError(code);
  }
  return body;
}
