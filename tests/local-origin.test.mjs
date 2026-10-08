import test from "node:test";
import assert from "node:assert/strict";
import { driveAccessError, sameOriginError } from "../src/server/local-drive.ts";

function localEnvironment(t) {
  const previous = { environment: process.env.VERCEL_ENV, enabled: process.env.GOOGLE_DRIVE_ENABLED };
  delete process.env.VERCEL_ENV;
  process.env.GOOGLE_DRIVE_ENABLED = "true";
  t.after(() => {
    for (const [name, value] of [["VERCEL_ENV", previous.environment], ["GOOGLE_DRIVE_ENABLED", previous.enabled]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
}
const request = (url, origin, host, extra = {}) => new Request(url, {
  method: "POST", headers: { ...(origin === undefined ? {} : { origin }), ...(host === undefined ? {} : { host }), ...extra },
});

test("local Drive validation accepts the browser Host when Next reconstructs another loopback hostname", t => {
  localEnvironment(t);
  for (const [server, browser] of [["localhost", "127.0.0.1"], ["127.0.0.1", "localhost"], ["localhost", "[::1]"], ["[::1]", "127.0.0.1"]]) {
    const value = request(`http://${server}:3000/api/drive/validate`, `http://${browser}:3000`, `${browser}:3000`);
    assert.equal(driveAccessError(value, true), null, `${server} reconstructed for browser ${browser}`);
  }
  assert.equal(sameOriginError(request("http://localhost/api/drive/validate", "http://127.0.0.1:80", "127.0.0.1:80")), null, "Default ports normalize");
});

test("local origin checks preserve missing-Host fallback and use a present Host as the authority", t => {
  localEnvironment(t);
  const url = "http://localhost:3000/api/drive/validate";
  assert.equal(sameOriginError(request(url, "http://localhost:3000")), null);
  assert.equal(sameOriginError(request(url, undefined)), null, "Existing local tooling may omit Origin");
  assert.equal(sameOriginError(request(url, "http://127.0.0.1:3000"))?.status, 403, "Alias alone cannot bypass a missing Host");
  assert.equal(sameOriginError(request(url, "http://localhost:3000", "127.0.0.1:3000"))?.status, 403, "Origin must match the browser Host");
});

test("local requests reject mismatched origins, ports, malformed hosts and forwarded-header bypasses", t => {
  localEnvironment(t);
  const url = "http://localhost:3000/api/drive/validate";
  for (const [origin, host] of [
    ["http://127.0.0.1:3001", "127.0.0.1:3000"],
    ["http://127.0.0.1:3001", "127.0.0.1:3001"],
    ["https://127.0.0.1:3000", "127.0.0.1:3000"],
    ["https://outside.example", "127.0.0.1:3000"],
    ["not-an-origin", "127.0.0.1:3000"],
    ["null", "127.0.0.1:3000"],
    ["http://localhost:3000", "outside.example:3000"],
    ["http://localhost:3000", "localhost:65536"],
    ["http://localhost:3000", "localhost:3000/path"],
    ["http://localhost:3000", "localhost:3000,127.0.0.1:3000"],
    ["http://localhost:3000", "user@localhost:3000"],
  ]) assert.equal(sameOriginError(request(url, origin, host))?.status, 403, `${origin} / ${host}`);
  assert.equal(sameOriginError(request(url, "http://127.0.0.1:3000", undefined, { "x-forwarded-host": "127.0.0.1:3000", "x-forwarded-proto": "http" }))?.status, 403);
  assert.equal(sameOriginError(request(url, "https://outside.example", "127.0.0.1:3000", { "x-forwarded-host": "outside.example", "x-forwarded-proto": "https" }))?.status, 403);
});

test("Vercel origins remain strict and Drive enablement still applies", t => {
  localEnvironment(t);
  for (const environment of ["preview", "production"]) {
    process.env.VERCEL_ENV = environment;
    const url = "https://app.example/api/drive/validate";
    assert.equal(driveAccessError(request(url, "https://app.example"), true), null);
    assert.equal(driveAccessError(request(url, undefined), true)?.status, 403);
    assert.equal(driveAccessError(request(url, "http://127.0.0.1:3000", "127.0.0.1:3000"), true)?.status, 403);
    assert.equal(sameOriginError(request("http://localhost:3000/api/drive/validate", "http://127.0.0.1:3000", "127.0.0.1:3000"))?.status, 403);
    process.env.GOOGLE_DRIVE_ENABLED = "false";
    assert.equal(driveAccessError(request(url, "https://app.example"), true)?.status, 503);
    process.env.GOOGLE_DRIVE_ENABLED = "true";
  }
  delete process.env.VERCEL_ENV;
  process.env.GOOGLE_DRIVE_ENABLED = "false";
  assert.equal(driveAccessError(request("http://localhost:3000/api/drive/validate", "http://127.0.0.1:3000", "127.0.0.1:3000"), true)?.status, 503);
});
