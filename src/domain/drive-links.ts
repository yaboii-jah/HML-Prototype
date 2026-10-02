export function validDriveFileLink(value: string, fileId: string): boolean {
  try {
    const url = new URL(value);
    if (!fileId || url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (url.hostname === "drive.google.com") return url.pathname.split("/")[3] === fileId && url.pathname.startsWith("/file/d/") || url.pathname === "/open" && url.searchParams.get("id") === fileId;
    return url.hostname === "docs.google.com" && url.pathname.startsWith("/spreadsheets/d/") && url.pathname.split("/")[3] === fileId;
  } catch { return false; }
}
