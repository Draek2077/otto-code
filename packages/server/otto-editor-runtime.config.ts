import { mergeConfig, defineConfig } from "vitest/config";
import base from "./vitest.config";
// OTTO(editor): a separate, unconditional real-tool suite. Its CI job owns the
// C#/.NET installation; ordinary daemon unit discovery does not pretend to run it.
export default mergeConfig(base, defineConfig({ test: { include: ["test-editor-csharp.ts"] } }));
