import { QUOTE_CHUNK_SIZE, type QuoteFile } from "@/src/domain/quotations/drafts";

export async function responseJson(response: Response) {
  const value = await response.json();
  if (!response.ok) throw Error(typeof value?.error === "string" ? value.error : "File action could not finish.");
  return value;
}

export async function fingerprint(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadQuotationFiles(
  files: { file: File; sha256: string }[], uploads: QuoteFile[], endpoint: string, onProgress: (message: string) => void,
) {
  for (const upload of uploads) {
    const match = files.find(({ file, sha256 }) => file.name === upload.name && file.size === upload.size && file.type === upload.mime && sha256 === upload.sha256);
    if (!match) throw Error(`Reselect the matching local file to resume: ${upload.name}`);
    const url = `${endpoint}/${upload.id}`;
    const check = async () => responseJson(await fetch(url, { method: "POST", cache: "no-store" }));
    let state = await check();
    while (!state.complete && !state.validating) {
      const offset = state.offset;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= match.file.size) throw Error("Invalid confirmed upload position.");
      onProgress(`${upload.name} · ${offset.toLocaleString()} / ${upload.size.toLocaleString()} bytes`);
      try {
        state = await responseJson(await fetch(`${url}?offset=${offset}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" },
          body: match.file.slice(offset, offset + QUOTE_CHUNK_SIZE) }));
      } catch (error) {
        const recovered = await check();
        if (recovered.offset === offset && !recovered.complete && !recovered.validating) throw error;
        state = recovered;
      }
    }
  }
}
