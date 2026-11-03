
import "server-only";
import { driveAccessToken } from "@/src/server/drive";
import { createDriveGateway } from "./drive-gateway";

export function documentDrive() {
  if (process.env.GOOGLE_DRIVE_ENABLED !== "true") throw Error("Document storage is unavailable.");
  const testOrigin = process.env.DOCUMENT_DRIVE_TEST_ORIGIN;
  if (testOrigin) {
    const origin = new URL(testOrigin);
    const database = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (process.env.CI !== "true" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
      || !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || origin.protocol !== "http:" || origin.pathname !== "/" || origin.username || origin.password) throw Error("Fake Drive requires isolated loopback CI.");
    return createDriveGateway(origin.origin, async () => "disposable-drive-token");
  }
  return createDriveGateway("https://www.googleapis.com", driveAccessToken);
}
export function documentRoot() {
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!root || !/^[\w-]{10,}$/.test(root)) throw Error("Configure a document root on the server.");
  return root;
}
