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
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.claude/**",
      "**/.dev/**",
      // DISABLED(hub): these three boot a real daemon through `createOttoDaemon`,
      // whose Hub wiring now resolves to the inert stand-ins in
      // `src/server/hub-disabled.ts`, so they can no longer pass. Excluding them
      // here rather than editing them keeps all six hub suites byte-identical to
      // upstream. The other three construct the controllers directly and still
      // run, which is what keeps this stub honest about upstream's interfaces.
      "**/src/server/hub/daemon-executions.test.ts",
      "**/src/server/hub/execution-session.websocket.test.ts",
      "**/src/server/hub/relationship-controller.test.ts",
    ],
  },
});
