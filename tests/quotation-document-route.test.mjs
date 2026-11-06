import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";

let actor = null,
  metadata,
  reads = 0,
  providerCalls = 0;
globalThis.__quotationDocumentActor = () => {
  if (!actor) throw Object.assign(Error("Sign in"), { status: 401 });
  return actor;
};
globalThis.__quotationDocumentRpc = async (name, values) => {
  reads++;
  assert.equal(values.actor, actor);
  assert.equal(name, "quotation_review_pdf");
  if (actor.activeRole === "Site Personnel")
    throw Object.assign(Error("Denied"), { status: 403 });
  return metadata;
};
globalThis.__quotationDocumentStream = async (id, range) => {
  providerCalls++;
  assert.equal(id, "private-provider-file");
  return new Response(
    Buffer.from("%PDF-synthetic").subarray(
      range?.start ?? 0,
      range ? range.end + 1 : undefined,
    ),
  );
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    let source;
    if (specifier === "@/src/server/documents/access")
      source = `export class DocumentHttpError extends Error { constructor(status,message){super(message);this.status=status} } export const documentActor=async()=>globalThis.__quotationDocumentActor();export const privateDocumentRead=request=>{if(request.headers.get('Sec-Fetch-Site')==='cross-site')throw new DocumentHttpError(403,'Origin denied')}`;
    if (specifier === "@/src/server/documents/config")
      source =
        "export const documentDrive=()=>({stream:(...args)=>globalThis.__quotationDocumentStream(...args)})";
    if (specifier === "@/src/server/auth/service-rpc")
      source =
        "export const serviceRpc=(...args)=>globalThis.__quotationDocumentRpc(...args)";
    if (
      specifier === "./files" &&
      context.parentURL?.endsWith("/quotations/read-document.ts")
    )
      source =
        "export const quotationFileError=error=>Response.json({error:error.message},{status:error.status||503})";
    if (source)
      return {
        url: "data:text/javascript," + encodeURIComponent(source),
        shortCircuit: true,
      };
    if (specifier.startsWith("@/"))
      return next(
        new URL("../" + specifier.slice(2) + ".ts", import.meta.url).href,
        context,
      );
    return next(specifier, context);
  },
});
const { GET } =
  await import("../app/api/quotation-revisions/[id]/review/route.ts");
const id = randomUUID(),
  context = { params: Promise.resolve({ id }) };
const request = (headers) =>
  new Request(
    "http://127.0.0.1:3198/api/quotation-revisions/" + id + "/review",
    { headers },
  );

test("review PDF route authorizes before provider access and retains private bounded Range behavior", async () => {
  assert.equal((await GET(request(), context)).status, 401);
  assert.equal(reads, 0);
  assert.equal(providerCalls, 0);
  actor = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    activeRole: "Site Personnel",
    revision: "1",
  };
  assert.equal((await GET(request(), context)).status, 403);
  assert.equal(providerCalls, 0);
  actor = { ...actor, activeRole: "Accounting" };
  metadata = {
    fileId: "private-provider-file",
    name: "Internal review.pdf",
    size: 14,
    mime: "application/pdf",
  };
  assert.equal(
    (await GET(request({ "Sec-Fetch-Site": "cross-site" }), context)).status,
    403,
  );
  const response = await GET(request({ Range: "bytes=0-4" }), context);
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "%PDF-");
  assert.equal(response.headers.get("content-range"), "bytes 0-4/14");
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const prior = providerCalls;
  assert.equal(
    (await GET(request({ Range: "bytes=0-1,4-5" }), context)).status,
    416,
  );
  assert.equal(providerCalls, prior);
  metadata.mime = "text/html";
  assert.equal((await GET(request(), context)).status, 503);
  assert.equal(providerCalls, prior);
});
