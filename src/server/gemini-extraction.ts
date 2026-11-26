import "server-only";
import { record } from "@/src/domain/projects/projects";

export function extractionSchema(properties: Record<string, object>) {
  return { type: "object", properties, required: Object.keys(properties) };
}

type Original = { mime: string; bytes: Uint8Array };

export async function extractOriginals(prompt: string, schema: object, originals: Original[]): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Error("Extraction is unavailable");
  const input = [{ type: "text", text: prompt }, ...originals.flatMap(({ mime, bytes }, index) => [
    ...(originals.length > 1 ? [{ type: "text", text: `Original ${index + 1}` }] : []),
    { type: mime === "application/pdf" ? "document" : "image", mime_type: mime, data: Buffer.from(bytes).toString("base64") },
  ])];
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key, "Api-Revision": "2026-05-20" },
    body: JSON.stringify({
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite", input, store: false,
      response_format: { type: "text", mime_type: "application/json", schema },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw Error("Extraction provider request failed");
  const body = record(await response.json());
  if (body?.status !== "completed" || !Array.isArray(body.steps)) throw Error("Extraction response was incomplete");
  const output = body.steps.flatMap((value: unknown) => {
    const step = record(value);
    if (step?.type !== "model_output" || !Array.isArray(step.content)) return [];
    return step.content.flatMap((value: unknown) => {
      const part = record(value);
      return part?.type === "text" && typeof part.text === "string" ? [part.text] : [];
    });
  }).join("");
  if (output.length > 500_000) throw Error("Extraction response exceeded the result limit");
  return JSON.parse(output);
}
