/** Shared transport for document extraction; prompts and domain validation stay with callers. */
export class ExtractionUpstreamError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("The extraction provider rejected the request.");
    this.status = status;
  }
}

export class ExtractionIncompleteError extends Error {}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export async function extractStructured(input: {
  prompt: string;
  schema: object;
  files: { mimeType: string; bytes: Uint8Array }[];
  signal: AbortSignal;
}): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Document extraction is not configured.");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: input.prompt }, ...input.files.map(file => ({ inlineData: { mimeType: file.mimeType, data: Buffer.from(file.bytes).toString("base64") } }))] }],
      generationConfig: { responseFormat: { text: { mimeType: "APPLICATION_JSON", schema: input.schema } } },
    }),
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(90_000)]),
  });
  if (!response.ok) throw new ExtractionUpstreamError(response.status);
  const payload: unknown = await response.json();
  const candidate = record(payload) && Array.isArray(payload.candidates) ? payload.candidates[0] : undefined;
  if (record(candidate) && candidate.finishReason && candidate.finishReason !== "STOP") throw new ExtractionIncompleteError("The extraction is incomplete.");
  const content = record(candidate) && record(candidate.content) ? candidate.content : undefined;
  const text = content && Array.isArray(content.parts)
    ? content.parts.filter(part => record(part) && typeof part.text === "string" && !part.thought).map(part => part.text).join("")
    : "";
  return JSON.parse(text);
}
