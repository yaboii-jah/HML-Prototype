import { unavailableOperation } from "@/src/server/auth/unavailable";

export const runtime = "nodejs";

export async function POST() {
  return unavailableOperation();
}
