# Which of the shipped-surface advisory candidates survived a code-level read?

**Date:** 2026-08-02
**Question:** The same-day [Dependabot alert triage](2026-08-02-dependabot-alert-triage.md) narrowed
183 alerts to a handful of candidates that touch code Otto ships, and left `fast-uri` explicitly
unresolved. `npm audit` adds two more names to that candidate list: `electron-updater` and the `hono`
copy under the MCP transport. Which of these survive a read of the actual call sites, and can a CI
gate reproduce the answer mechanically?

**Answer:** None survived as exploitable. One (`electron-updater`) was worth fixing anyway because
the fix was a lockfile-only bump; `hono` and `fast-uri` got the same free bumps while being dismissed.
A 170-line lockfile-graph gate reproduces the whole manual triage: run against the pre-fix tree it
flags exactly the six packages the human analysis called real, and nothing else.

---

## Method

Each candidate got the same treatment: locate every first-party call site, read what data flows into
the vulnerable code, and decide whether the advisory's precondition can occur. Versions were then
moved only where the fix stayed inside the declared semver range, so `package.json` never changed.

Environment: repo at `bb03a4496` plus the in-flight `markdown-it@^15` override from the concurrent
markdown task, Windows 11, npm 11 / Node v24.17.0.

## `electron-updater` 6.8.3 (GHSA-p2f4-r6v6-j797, high): theoretical, fixed anyway

The advisory: `builder-util-runtime < 9.7.0` re-sends `PRIVATE-TOKEN` and mixed-case `Authorization`
headers across cross-origin redirects. That requires the update flow to carry credentials in the
first place.

Otto's does not:

- `packages/desktop/electron-builder.yml` publishes to public GitHub (`provider: github`, owner
  `Draek2077`, repo `otto-code`), with no `private` flag and no token in the publish config.
  electron-updater only attaches credentials for private repos or token-configured providers.
- A grep of `packages/desktop/src/features/` for `Authorization`, `PRIVATE-TOKEN`, `GH_TOKEN` and
  header-carrying token uses found none in the update path (`auto-updater.ts`,
  `app-update-service.ts`, `manual-download-update-runtime.ts`). The rollout manifest fetch is
  unauthenticated.

So there is no credential to leak. Fixed regardless, because `electron-updater@6.8.3` pins
`builder-util-runtime` **exactly** at 9.5.1, and 6.8.9 (inside the declared `^6.6.2`) pins 9.7.0:
a lockfile-only `npm update --workspaces --include-workspace-root electron-updater`. Note that plain
`npm update electron-updater` at the root silently updates nothing for a workspace-member dependency;
the `--workspaces` flag is load-bearing.

The 9.5.1 copy that remains lives only under `electron-builder@26.8.1` (exact pin from
`app-builder-lib`), which runs at packaging time on CI, never on a user's machine. Left alone per
the `.github/dependabot.yml` position on Electron pins.

## `fast-uri` ×2 (GHSA-v2hh-gcrm-f6hx, GHSA-4c8g-83qw-93j6, high): dismissed, closing the open item

The earlier triage declined to rule this out without reading how ajv uses URIs. Three facts close it:

1. The only first-party ajv instantiation is `agent-response-loop.ts:157`, constructed as
   `{ allErrors: true, strict: false }` with **no `ajv-formats`**. `ajv` v8 without `ajv-formats`
   does not evaluate `format: "uri"` (or any format) at all; there is no format check to confuse.
   `rg "ajv-formats|addFormat"` over `packages/*/src` returns zero first-party hits.
2. Inside ajv, `fast-uri` serves `$id`/`$ref` resolution. The schemas fed to it are constructed by
   Otto itself (from zod via `zod-to-json-schema`, or from a provider's tool schema), and the
   resolved URI is used as a schema registry key, never as a hostname that gates a decision.
3. `@modelcontextprotocol/sdk@1.29.0` does ship `ajv-formats` for its own tool-schema validation,
   but a `format: uri` pass/fail on a tool argument string is shape validation; nothing downstream
   branches on the parsed authority.

The advisory's precondition, "a security decision made from a parsed authority", does not occur.
Bumped 3.1.2 → 3.1.5 in the lockfile anyway (free, inside ajv's range).

## `hono` 4.12.18, 12 advisories (1 high): dismissed, and the delegation claim verified

The earlier triage established the daemon has zero `hono` imports and the MCP SDK's
`streamableHttp.js` imports exactly one symbol from `@hono/node-server`. The remaining question was
the deliberate `enableDnsRebindingProtection: false` on the MCP transport
(`bootstrap.ts:1936`), whose comment delegates Host checking to the app layer. Verified that the
delegation holds for `/mcp/agents`:

- The Vite-style Host allowlist is an `app.use` middleware (`bootstrap.ts:1017`) registered during
  bootstrap **before** the MCP route handler is mounted (~line 2000 of the same function), so every
  TCP HTTP request to `/mcp/agents` passes `isHostnameAllowed` first. A DNS-rebinding request
  arrives with the attacker's hostname in `Host` and gets a 403 before the transport sees it.
- The parse in `hostnames.ts` handles bracketed IPv6 itself and classifies raw IPs with
  `net.isIP`; hono's non-canonical-IPv6 `ipRestriction` bug is not in this path, and `ipRestriction`
  (like `cors`, `jwt`, `serve-static` and every other advisory-bearing hono module) is never
  imported.
- Independently, the route requires a per-daemon-run capability token or the daemon password
  (`auth.ts`, `isAgentMcpRequestAuthorized`) whenever a password is configured.

Bumped 4.12.18 → 4.12.33 in the lockfile (inside the SDK's `^4.11.4`), which clears all 12
advisories.

## `markdown-it` / `linkify-it`: not this task

Covered by the concurrent markdown-it override task. The audit re-runs here simply confirmed that
with `markdown-it@^15` forced, both packages leave the report entirely (110 → 66 total advisories).

## The Dependabot settings check: nothing was off

`GET /repos/Draek2077/otto-code` shows `dependabot_security_updates: enabled`, and
`/automated-security-fixes` shows `{enabled: true, paused: false}`. The standing backlog is not a
disabled setting: it is fix-infeasibility. The vulnerable copies sit under exact or narrow transitive
pins in the Expo/RN/Electron toolchains, where Dependabot cannot construct a compatible update. The
three npm security PRs it did manage (#5, #6, #7) were all closed unmerged, consistent with the
pin-protection stance in `dependabot.yml`.

## The gate: `scripts/audit-shipped.mjs`

The whole-tree `dev` flag misclassifies the Expo/Metro chain as production (the earlier finding's
central measurement), so a raw `npm audit` CI gate would be permanently red. The gate instead
rebuilds the graph from `package-lock.json`, BFS-walks production+optional edges from the five
shipped workspace roots (`server`, `desktop`, `cli`, `relay`, `app`) with npm's walk-up resolution,
prunes ~20 justified build-tooling entry points, and fails on high/critical advisories whose
lockfile paths land in that closure.

Validation, both directions:

| Tree                            | Closure size | High/critical flagged                                                                                  |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| Pre-fix `HEAD` (`bb03a4496`)    | 973 of 3,004 | Exactly 6: `electron-updater`, `builder-util-runtime`, `fast-uri`, `hono`, `markdown-it`, `linkify-it` |
| After override + lockfile bumps | 967          | 0                                                                                                      |

The false-positive candidates it correctly suppresses include `react-native`'s own production
dependency list, which declares `babel-jest`, `jest-environment-node`, `@react-native/codegen`,
`community-cli-plugin`, `gradle-plugin`, `react-devtools-core`, `glob` and `ws`, all of it
dev/build/test tooling. That list is the single biggest source of "production" misclassification in
the tree.

It runs weekly off the PR path (`.github/workflows/audit-shipped.yml`), because a new upstream
advisory must not block unrelated PRs; that is the noise failure mode `dependabot.yml` guards
against.

## Retired hypotheses

- **"Dependabot security updates are probably just switched off."** They are on and unpaused; the
  backlog is structural (transitive pins), so no repository setting fixes it.
- **"The 39 npm-audit highs in the production closure are 39 exposures."** By unique package it was
  16, and by shipped closure it was 6, all six already in flight or fixed here. `npm audit`'s
  per-path counting and npm's `dev` flag both overstate.
- **"The updater could leak a token on redirect."** There is no token anywhere in the update flow to
  leak; the fix was taken for hygiene, not necessity.
