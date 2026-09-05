import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { windowsShortPath } from "../test-utils/windows-short-path.js";

const execFileAsync = promisify(execFile);

describe.skipIf(process.platform !== "win32")("native directory watcher", () => {
  it.each([false, true])(
    "delivers changes beneath an 8.3 root (recursive=%s)",
    async (recursive, context) => {
      const directory = await mkdtemp(path.join(tmpdir(), "otto watcher fixture "));
      try {
        const short = windowsShortPath(directory);
        if (!short.includes("~")) context.skip("Fixture volume does not expose 8.3 names");
        // An unnormalized root triggers a native assertion, so keep the real
        // watcher in a child process and make its exit part of the assertion.
        const source = `
        import { writeFileSync } from 'node:fs';
        import { join } from 'node:path';
        import { watchDirectory } from ${JSON.stringify(new URL("./watch-directory.ts", import.meta.url).href)};
        const timer = setTimeout(() => { watcher.close(); process.exitCode = 1; }, 3000);
        const watcher = watchDirectory(${JSON.stringify(short)}, { recursive: ${recursive} }, (_, filename) => {
          if (filename !== 'changed.txt') return;
          console.log(filename);
          clearTimeout(timer);
          watcher.close();
        });
        writeFileSync(join(${JSON.stringify(directory)}, 'changed.txt'), 'updated');
      `;
        const result = await execFileAsync(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", source],
          { timeout: 10000 },
        );
        expect(result.stdout).toContain("changed.txt");
      } finally {
        await rm(directory, { recursive: true, force: true, maxRetries: 5 });
      }
    },
  );
});
