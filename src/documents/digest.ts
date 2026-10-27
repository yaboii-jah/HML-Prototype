export async function documentDigest(blob: Blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), value => value.toString(16).padStart(2, "0")).join("");
}
