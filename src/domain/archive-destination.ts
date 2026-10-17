import { validDriveFileLink } from "./drive-links.ts";
import type { DemoSnapshot, Site } from "./types.ts";

export const archiveReady = (site?: Site) => !!(site?.driveFolderId || site?.localArchiveId);
export const localArchiveUrl = (fileId: string) => `/demo-files/${encodeURIComponent(fileId)}`;
export function validArchiveFileLink(state: DemoSnapshot, url: string, fileId: string) {
  if (url.startsWith("/demo-files/")) return !!state.showcase && fileId.startsWith(`local-${state.showcase.installationId}-`) && url === localArchiveUrl(fileId);
  return validDriveFileLink(url, fileId);
}
