// Start the throwaway prototype without disturbing the ordinary development server.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
console.log("Quotation worksheet prototype: http://localhost:3200/requests/prototype/quotes?reviewPrototype=1&variant=A");
console.log("Sign in with an existing department account. Sample worksheet edits stay in memory.");
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3200"], { stdio: "inherit", windowsHide: true, env: { ...process.env, PROCUREMENT_REVIEW_PROTOTYPE: "1" } });
child.on("exit", code => { process.exitCode = code ?? 0; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
