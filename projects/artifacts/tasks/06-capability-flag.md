# Task: Add Artifacts Capability Flag

## Goal

Add a server-side capability flag `server_info.features.artifacts` so the client can detect whether the connected daemon supports the artifacts feature.

## Context

Otto gates new features behind capability flags in `server_info.features.*`. A `// COMPAT(featureName): added in v0.1.X, drop the gate when floor >= v0.1.X` comment marks the cleanup site.

## References

- `CLAUDE.md` — section on capability flags: "Capability flags live in `server_info.features.*`"
- `docs/artifacts.md` — section "Capability Flag": `server_info.features.artifacts` with `COMPAT(artifacts)` comment
- `packages/server/src/server/config.ts` — search for `features` to find where server_info features are assembled
- `packages/protocol/src/otto-config-schema.ts` — server info schema if it exists

## What to Do

1. Find where `server_info.features` is constructed (likely in the server's config or bootstrap code)
2. Add an `artifacts` boolean field set to `true`
3. Add a `// COMPAT(artifacts):` comment at the site
4. If there's a client-side feature hook (e.g., `useHostFeature`), verify it can read this flag — no extra code needed if the hook reads `server_info.features` generically

## Acceptance Criteria

- `server_info.features.artifacts` is `true` when the daemon starts
- A `// COMPAT(artifacts):` comment exists at the site
- No breaking changes to existing server_info shape
