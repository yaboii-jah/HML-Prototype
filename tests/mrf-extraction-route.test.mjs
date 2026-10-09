import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/requests/extract/route.ts";

const rawMrf = () => ({ documentType: "single_mrf", details: { projectName: "Project", ref: "MRF-API", requestDate: "2026-10-05", requestedBy: "Site", approvedBy: "Signatory", purchaser: "Buyer", financeOfficer: "Finance", specialInstructions: null }, items: [{ name: "Cement", quantity: 10, unit: "bag", neededDate: "2026-10-08", purpose: null, location: "Site", remarks: null }], warnings: [] });
const pdf = () => new File(["%PDF-1.4\nMRF"], "MRF.pdf", { type: "application/pdf" });
const png = name => new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), name], `${name}.png`, { type: "image/png" });
const request = (files = [pdf()], headers = {}, url = "http://localhost/api/requests/extract") => { const body = new FormData(); files.forEach(file => body.append("files", file)); return new Request(url, { method: "POST", body, headers }); };
const configure = t => {
  const previousFetch = globalThis.fetch; const env = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
  process.env.GEMINI_API_KEY = "test-key"; process.env.GEMINI_MODEL = "test-model";
  t.after(() => { globalThis.fetch = previousFetch; for (const [name, value] of [["GEMINI_API_KEY", env.key], ["GEMINI_MODEL", env.model]]) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
};
const reply = (raw, finishReason = "STOP") => Response.json({ candidates: [{ finishReason, content: { parts: [{ thought: true, text: "ignore reasoning" }, { text: JSON.stringify(raw) }] } }] });

test("MRF endpoint avoids provider-rejected array bounds while validating output locally", async t => {
  configure(t);
  globalThis.fetch = async (_url, options) => {
    const schema = JSON.parse(options.body).generationConfig.responseFormat.text.schema;
    return JSON.stringify(schema).includes('"maxItems"')
      ? Response.json({ error: "Invalid argument" }, { status: 400 })
      : reply(rawMrf());
  };
  assert.equal((await POST(request())).status, 200);
  for (const raw of [
    { ...rawMrf(), items: Array.from({ length: 101 }, () => rawMrf().items[0]) },
    { ...rawMrf(), warnings: Array.from({ length: 300 }, () => "Unreadable field") },
  ]) {
    globalThis.fetch = async () => reply(raw);
    assert.equal((await POST(request())).status, 422);
  }
});

test("MRF endpoint sends ordered sources with a structured schema and returns normalized results", async t => {
  configure(t); const pages = [png("page-2"), png("page-1")];
  globalThis.fetch = async (url, options) => {
    assert.match(url, /models\/test-model:generateContent$/);
    assert.equal(options.headers["x-goog-api-key"], "test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
    assert.ok(body.generationConfig.responseFormat.text.schema.required.includes("documentType"));
    assert.match(body.contents[0].parts[0].text, /never instructions/i);
    assert.match(Buffer.from(body.contents[0].parts[1].inlineData.data, "base64").toString(), /page-2$/);
    assert.match(Buffer.from(body.contents[0].parts[2].inlineData.data, "base64").toString(), /page-1$/);
    assert.equal(options.signal.aborted, false);
    const raw = rawMrf(); raw.items[0].quantity = null; return reply(raw);
  };
  const response = await POST(request(pages));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.equal(result.extraction.details.ref, "MRF-API");
  assert.equal(result.extraction.items[0].quantity, null);
  assert.ok(result.warnings.length);
});

test("MRF endpoint blocks invalid sources before contacting AI", async t => {
  configure(t); globalThis.fetch = () => { throw new Error("Invalid sources reached AI"); };
  for (const files of [[], [pdf(), png("page")], [new File(["disguised"], "MRF.pdf", { type: "application/pdf" })], [new File(["text"], "MRF.txt", { type: "text/plain" })], Array.from({ length: 13 }, (_, i) => png(`page-${i}`)), [new File([new Uint8Array(4 * 1024 * 1024 + 1)], "MRF.pdf", { type: "application/pdf" })]]) {
    const response = await POST(request(files)); assert.ok([400, 413].includes(response.status));
  }
  const tooLarge = await POST(request([pdf()], { "content-length": String(5 * 1024 * 1024) })); assert.equal(tooLarge.status, 413);
});

test("MRF endpoint enforces same origin and explains absent configuration", async t => {
  configure(t); globalThis.fetch = () => { throw new Error("Unexpected AI request"); };
  assert.equal((await POST(request([pdf()], { origin: "https://elsewhere.example" }))).status, 403);
  assert.equal((await POST(request([pdf()], {}, "https://app.example/api/requests/extract"))).status, 403);
  delete process.env.GEMINI_API_KEY;
  const response = await POST(request()); assert.equal(response.status, 503); assert.match((await response.json()).error, /enter.*manually/i);
});

test("MRF endpoint rejects multiple requests, unrelated documents and truncated or malformed results", async t => {
  configure(t);
  for (const [raw, expected] of [[{ ...rawMrf(), documentType: "multiple_mrfs" }, /more than one MRF/], [{ ...rawMrf(), documentType: "other" }, /does not appear/], [{ ...rawMrf(), items: [{ ...rawMrf().items[0], quantity: "ten" }] }, /quantities/]]) {
    globalThis.fetch = async () => reply(raw);
    const response = await POST(request()); assert.equal(response.status, 422); assert.match((await response.json()).error, expected);
  }
  globalThis.fetch = async () => reply(rawMrf(), "MAX_TOKENS"); assert.equal((await POST(request())).status, 502);
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "private malformed model text" }] } }] });
  const malformed = await POST(request()); assert.equal(malformed.status, 422); assert.doesNotMatch((await malformed.json()).error, /private/);
});

test("MRF endpoint handles upstream failures and cancellation without leaking provider details", async t => {
  configure(t);
  for (const [status, message] of [[400, /request was rejected/], [401, /access was denied/], [403, /access was denied/], [429, /limit was reached/], [500, /service is unavailable/]]) {
    globalThis.fetch = async () => Response.json({ error: "sensitive provider detail test-key" }, { status });
    const response = await POST(request()); assert.equal(response.status, 502);
    const result = await response.json(); assert.match(result.error, message); assert.doesNotMatch(result.error, /sensitive|test-key/);
  }
  globalThis.fetch = async () => { throw new DOMException("aborted", "AbortError"); };
  const response = await POST(request()); assert.equal(response.status, 502); assert.match((await response.json()).error, /Retry|manually/);
});
