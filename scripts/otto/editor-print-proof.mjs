// CI-only: no app main, daemon, installed profile, credentials or model runtime.
import { app } from "electron";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const root = new URL("../../.tmp/editor-print-proof/", import.meta.url);
mkdirSync(root, { recursive: true });
mkdirSync(new URL("profile/", root), { recursive: true });
app.setPath("userData", fileURLToPath(new URL("profile/", root)));
// Let the ESM entry finish loading before waiting for Electron readiness.
// No product startup runs, and the profile is set synchronously before ready.
const watchdog = setTimeout(() => {
  process.stderr.write("Isolated editor PDF proof exceeded 45 seconds.\n");
  app.exit(1);
}, 45000);
void main();
async function main() {
  let requests = 0;
  const probe = createServer((_request, response) => {
    requests++;
    response.end("unexpected");
  });
  try {
    await app.whenReady();
    process.stdout.write("Isolated Electron ready\n");
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", resolve);
    });
    const address = probe.address();
    assert.ok(address && typeof address !== "string");
    const { printEditorPdf } = await import("../../packages/desktop/dist/otto/editor/print.js");
    const result = await printEditorPdf(
      `<!doctype html><meta charset="utf-8"><style>body{color:#123456}h1{font-size:28px}</style><h1>Otto editor µ</h1><math><msup><mi>x</mi><mn>2</mn></msup></math><svg width="100" height="50"><rect width="100" height="50" fill="green"/></svg><img src="http://127.0.0.1:${address.port}/must-not-load"><script>fetch('http://127.0.0.1:${address.port}/must-not-run')</script>`,
    );
    const pdf = Buffer.from(result, "base64");
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 1000);
    assert.equal(requests, 0);
    await writeFile(new URL("document.pdf", root), pdf);
    await writeFile(
      new URL("result.json", root),
      JSON.stringify({ bytes: pdf.length, networkRequests: requests, pdfHeader: "%PDF-" }),
    );
    process.stdout.write(`Static editor PDF: ${pdf.length} bytes, ${requests} network requests\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    if (probe.listening) await new Promise((resolve) => probe.close(resolve));
    clearTimeout(watchdog);
    app.exit(process.exitCode ?? 0);
  }
}
