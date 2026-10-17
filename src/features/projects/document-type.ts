/** Display only file information available from the name or Drive MIME type. */
export function projectDocumentType(name: string, mimeType = "") {
  if (mimeType === "application/vnd.google-apps.folder") return "Folder";
  const extension = name.split(".").length > 1 ? name.split(".").at(-1)?.toLowerCase() : "";
  if (extension === "pdf" || mimeType === "application/pdf") return "PDF";
  if (["xlsx", "xls", "csv"].includes(extension || "") || /spreadsheet|excel|csv/.test(mimeType)) return "Spreadsheet";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension || "") || mimeType.startsWith("image/")) return "Image";
  if (["doc", "docx"].includes(extension || "") || /word|google-apps.document/.test(mimeType)) return "Document";
  return extension?.toUpperCase() || "File";
}
