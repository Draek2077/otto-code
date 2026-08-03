import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      // `cloudflare:workers` only exists inside the Workers runtime; point it
      // at a mutable stub so handler modules load under plain vitest.
      "cloudflare:workers": fileURLToPath(
        new URL("./src/test-stubs/cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
});
