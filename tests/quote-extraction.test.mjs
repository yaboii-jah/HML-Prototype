import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
  },
});

const { POST } = await import("../app/api/quotes/extract/route.ts");

const quotationRequest = () => {
  const form = new FormData();
  form.append("files", new File(["sample quotation"], "quote.pdf", { type: "application/pdf" }));
  return new Request("http://localhost/api/quotes/extract", { method: "POST", body: form });
};

test("quotation extraction sends Gemini's JSON format and returns reviewed lines", async t => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  });
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "test-model";

  globalThis.fetch = async (url, options) => {
    assert.match(url, /models\/test-model:generateContent$/);
    assert.equal(options.headers["x-goog-api-key"], "test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, "application/pdf");
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ supplier: "Test Supplier", lines: [{ description: "Cement", quantity: 10, unit: "bag", unitPrice: 250 }] }) }] } }] });
  };

  const response = await POST(quotationRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).extraction.lines[0].description, "Cement");
});

test("quotation extraction explains an upstream invalid request without exposing its details", async t => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = async () => Response.json({ error: { message: "sensitive upstream details" } }, { status: 400 });

  const response = await POST(quotationRequest());
  const result = await response.json();
  assert.equal(response.status, 502);
  assert.match(result.error, /Gemini rejected the quotation request/);
  assert.doesNotMatch(result.error, /sensitive upstream details/);
});
