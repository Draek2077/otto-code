import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Mirrors vendor/agent-flow/web/vite.config.shared.ts (createBuildConfig) with an
// Otto entry point. Kept outside the vendor tree so `git subtree pull` stays clean.
const vendorWeb = resolve(__dirname, "../../vendor/agent-flow/web");
const demo = process.env.VISUALIZER_DEMO === "1";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": vendorWeb,
    },
  },
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/otto-entry.tsx"),
      formats: ["iife"],
      name: "OttoVisualizer",
      fileName: () => "index",
    },
    // Valid in Vite 8; not yet reflected in the bundled types.
    // @ts-expect-error -- cssFileName missing from LibraryOptions
    cssFileName: "index",
    sourcemap: false,
    minify: true,
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
        assetFileNames: (info: { names?: string[] }) => {
          if (info.names?.[0]?.endsWith(".css")) return "index.css";
          return "[name].[ext]";
        },
      },
    },
  },
  define: {
    "process.env.NODE_ENV": '"production"',
    // DEMO=1 auto-plays the built-in mock scenario (verification builds only).
    // Production shells ship DEMO=0; the host can still enable mock data via a
    // `config` bridge message ({ showMockData: true }).
    "process.env.NEXT_PUBLIC_DEMO": demo ? '"1"' : '"0"',
    // Compiles out the standalone SSE relay path (use-vscode-bridge.ts).
    "process.env.NEXT_PUBLIC_RELAY_PORT": '""',
    "process.env.AGENT_FLOW_STANDALONE": '"0"',
  },
});
