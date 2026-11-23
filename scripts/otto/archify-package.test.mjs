import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ArchitecturalViewRenderer,
  archifyRuntimeDirectory,
} from "../../packages/server/dist/server/server/otto/architectural-views/renderer.js";
import { viewStarter } from "../../packages/server/dist/server/server/otto/architectural-views/starter.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
test("compiled daemon renders from its packaged offline payload, retaining licenses and trace inputs", async () => {
  const runtime = archifyRuntimeDirectory();
  assert.ok(runtime.startsWith(path.join(root, "packages/server/dist/")));
  assert.match(await readFile(path.join(runtime, "LICENSE"), "utf8"), /MIT/);
  assert.ok((await readFile(path.join(runtime, "THIRD_PARTY_NOTICES.md"), "utf8")).length > 0);
  assert.ok(
    (await readFile(path.join(root, "scripts/trace-daemon.mjs"), "utf8")).includes(
      '"packages/server/dist/server/server/otto/architectural-views/vendor/archify/**"',
    ),
  );
  const fixtures = path.join(root, ".tmp/archify-restoration/package-fixtures");
  await mkdir(fixtures, { recursive: true });
  const home = await mkdtemp(path.join(fixtures, "packaged-"));
  const renderer = new ArchitecturalViewRenderer({
    boundary: home,
    scratchRoot: path.join(home, "render"),
  });
  try {
    const result = await renderer.render({
      diagramType: "sequence",
      specification: viewStarter("sequence", "Packaged source"),
      projectRoot: home,
    });
    assert.equal(result.receipt.ok, true);
    assert.match(result.html, /Packaged source/);
  } finally {
    await renderer.close();
    const relative = path.relative(fixtures, home);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await rm(home, { recursive: true, force: true });
  }
});
