import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
  },
});

const { POST } = await import("./fixtures/prototype-api/quotes/extract/route.ts");

const quotationRequest = () => {
  const form = new FormData();
  form.append("files", new File(["%PDF-1.4\nsample quotation"], "quote.pdf", { type: "application/pdf" }));
  return new Request("http://localhost/api/quotes/extract", { method: "POST", body: form });
};

test("quotation transport ignores thought parts, joins text parts and propagates cancellation", async t => {
  const previousFetch = globalThis.fetch, previousKey = process.env.GEMINI_API_KEY;
  t.after(() => { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey; });
  process.env.GEMINI_API_KEY = 'test-key';
  const controller = new AbortController();
  const request = new Request(quotationRequest(), { signal: controller.signal });
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.signal.aborted, false);
    controller.abort();
    assert.equal(options.signal.aborted, true);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private reasoning' }, { text: '{"lines":' }, { text: '[{"description":"Cement","quantity":10,"unitPrice":250}]}' }] } }] });
  };
  const response = await POST(request);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).extraction.lines[0].description, 'Cement');
});

test("quotation extraction rejects a truncated result even when its partial JSON parses", async t => {
  const previousFetch = globalThis.fetch, previousKey = process.env.GEMINI_API_KEY;
  t.after(() => { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey; });
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"lines":[]}' }] } }] });
  assert.equal((await POST(quotationRequest())).status, 502);
});

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

test("quotation rejects foreign origins, disguised bytes and malformed bodies without provider work", async t => {
  const previousKey = process.env.GEMINI_API_KEY, previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey; });
  process.env.GEMINI_API_KEY = 'test-key'; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('Provider must not run'); };
  const foreign = quotationRequest(); foreign.headers.set('origin', 'https://outside.example');
  assert.equal((await POST(foreign)).status, 403);
  const form = new FormData(); form.append('files', new File(['plain text'], 'quote.pdf', {type:'application/pdf'}));
  assert.equal((await POST(new Request('http://localhost/api/quotes/extract', {method:'POST',body:form}))).status, 400);
  const malformed = new Request('http://localhost/api/quotes/extract', {method:'POST',headers:{'content-type':'multipart/form-data; boundary=missing'},body:'broken'});
  const response = await POST(malformed); assert.equal(response.status,400); assert.ok((await response.json()).error);
  const mixed = new FormData(); mixed.append('files', 'not-a-file');
  assert.equal((await POST(new Request('http://localhost/api/quotes/extract', {method:'POST',body:mixed}))).status,400); assert.equal(calls,0);
});
