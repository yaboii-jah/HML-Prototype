import "server-only";
import { readSession } from "./session";

export async function unavailableOperation() {
  try {
    const session = await readSession();
    if (!session) return Response.json({ error: "Sign in again to continue." }, { status: 401 });
    return Response.json({ error: "This operation is temporarily unavailable." }, { status: 503 });
  } catch {
    return Response.json({ error: "Access could not be checked. Please try again." }, { status: 503 });
  }
}
