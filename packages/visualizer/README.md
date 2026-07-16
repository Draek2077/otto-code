# @otto-code/visualizer

Build-time package for the **Visualizer** workspace tab. Compiles the render layer of the vendored [agent-flow](https://github.com/patoles/agent-flow) project (`vendor/agent-flow/web`, Apache 2.0 — derived work; "Agent Flow" is upstream's trademark and is never used as our feature name) with the Otto entry (`src/otto-entry.tsx`) into a single self-contained HTML shell, emitted as `packages/app/src/visualizer/visualizer-bundle.gen.ts`.

- `npm run build:visualizer` (root) — production shell → committed `.gen.ts` module
- `npm run build:visualizer:demo` (root) — demo shell → `.demo/index.html` (gitignored; drive it by posting `{type:'config', config:{mode:'replay', autoPlay:true, showMockData:true}}` to the window)

Docs: [docs/visualizer.md](../../docs/visualizer.md) (architecture, bridge contract, subtree pull playbook — read before touching `vendor/`). react/react-dom here stay pinned to the app's exact version so npm hoists one copy.
