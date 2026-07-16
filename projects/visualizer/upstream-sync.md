# vendor/agent-flow — upstream sync playbook

`vendor/agent-flow/` is a **git subtree** (squashed) of https://github.com/patoles/agent-flow (remote: `agentflow`). The initial import was created in stock subtree format (squash commit + merge commit carrying `git-subtree-dir` / `git-subtree-split` metadata), so standard subtree tooling works.

## Rules

1. **No Otto code inside `vendor/`.** All integration lives in `packages/visualizer/` (build + entry) and `packages/app/src/visualizer/` (embed + adapter).
2. **In-vendor patches are a last resort.** Each one gets an entry in `vendor/agent-flow/OTTO-PATCHES.md` (create it on first patch): file, what changed, why, upstream-PR status. This file is also our Apache 2.0 "state changes" notice. Prefer upstream PRs (theming, logo registry, panel config) over carrying patches.
3. **Never format or lint the vendor tree.** `vendor/**` is ignore-listed in `.oxfmtrc.json` and `.oxlintrc.json` — keep it that way.
4. Only `web/` is compiled. `extension/`, `app/`, `scripts/` are inert reference (they carry the canonical bridge protocol in `extension/src/protocol.ts`).

## Pulling upstream updates

```bash
git fetch agentflow main --no-tags
LEFTHOOK=0 git subtree pull --prefix vendor/agent-flow https://github.com/patoles/agent-flow.git main --squash
```

`LEFTHOOK=0` matters: the pre-commit hooks run format-check/lint on staged files and would fail on vendor code. (If the pull merge-conflicts with local patches, resolve inside `vendor/`, keeping OTTO-PATCHES.md accurate.)

Then:

1. **Diff upstream's build inputs:** `git diff HEAD@{1} -- vendor/agent-flow/web/package.json vendor/agent-flow/web/vite.config.shared.ts vendor/agent-flow/web/webview-entry.tsx vendor/agent-flow/web/lib/bridge-types.ts`
   - `web/package.json` dep changes → mirror in `packages/visualizer/package.json` devDeps. **Exception: react/react-dom stay pinned to the app's exact version** (see `packages/app/package.json`) so one hoisted copy serves both and react/react-dom never mismatch.
   - `webview-entry.tsx` / `vite.config.shared.ts` changes → mirror intent in `packages/visualizer/src/otto-entry.tsx` / `vite.config.ts`.
   - `bridge-types.ts` / `hooks/simulation/*` changes → check the adapter mapping (`packages/app/src/visualizer/`) and the charter's payload table still hold.
2. **Rebuild:** `npm install && npm run build:visualizer` — commits the regenerated `packages/app/src/visualizer/visualizer-bundle.gen.ts`.
3. **Verify:** demo scenario in a visible pane (task 02's check), then a live agent session.
4. `npm run typecheck && npm run lint`.

## Escape hatch

If upstream drift makes pulls uneconomical, stop pulling — the vendor tree simply freezes and we own it (product-owner-approved fallback). Nothing else changes.
