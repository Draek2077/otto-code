import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@server": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    testTimeout: 30000,
    hookTimeout: 60000,
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(__dirname, "./src/test-utils/vitest-setup.ts")],
    pool: "forks",
    fileParallelism: false,
    // CI runs this suite with --fileParallelism, which overrides the line above.
    // On GitHub's Windows runners (4 vCPU / 16GB) the default fork count then
    // exhausts the box: vitest finishes with every test passing but reports
    // "Worker exited unexpectedly" three or four times and exits non-zero, so the
    // job fails with zero failing tests. Capping forks keeps peak memory in range.
    // Scoped to CI Windows on evidence: the same 390 files at the same flags run
    // clean on a Windows machine with more cores and RAM, and Linux never crashes.
    ...(process.platform === "win32" && process.env.CI
      ? { poolOptions: { forks: { maxForks: 2 } } }
      : {}),
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/.dev/**"],
  },
});
