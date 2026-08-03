# Dependabot: what do the 183 alerts on `Draek2077/otto-code` actually expose?

**Date:** 2026-08-02
**Question:** A `git push` to `main` reported 183 open Dependabot alerts (3 critical, 92 high, 70
moderate, 18 low). How many describe code that runs on a user's machine, and how many describe build
tooling that never ships?

**Answer:** 3 of 183. The three that matter are all `high`, none of them are the three `critical`
alerts, and the largest single cluster in the report (85 alerts, 46% of the total, including every
critical) comes from a lockfile that nothing installs from.

---

## Method

All numbers come from the GitHub API rather than the alert web page, joined against this checkout's
resolved dependency tree.

```bash
# 1. Pull every alert, all states, across all 5 pages.
gh api repos/Draek2077/otto-code/dependabot/alerts --paginate --slurp > db.json

# 2. Reverse-dependency analysis over the root lockfile (script listed in "Reproducing" below).
node otto-triage.js summary          # peer edges traversed
NO_PEER=1 node otto-triage.js json   # peer edges excluded (the numbers used here)

# 3. Per-package provenance.
npm ls <pkg> --workspace packages/server
```

**Environment.** Windows 11, Node v24.17.0, npm workspaces, root `package-lock.json`
lockfileVersion 3 (3,004 entries). Repo at `bb03a4496`, upstream Paseo at `f68215630`.

**The classifier.** npm's own `dev` flag in the lockfile is not sufficient, because it answers "is
this reachable only through a devDependency edge" for the tree as a whole, not "which workspace pulls
it". So the script rebuilds the graph from the lockfile `packages` map, resolves each dependency name
by npm's walk-up-the-`node_modules` rule, then runs two BFS passes from every workspace root: one
following only production edges, one following any edge. `devDependencies` are followed at the first
hop only, because a dependency's own devDependencies are never installed.

**One correction applied mid-run.** The first pass traversed `peerDependencies` as production edges.
That inflated `packages/app` and made `packages/expo-two-way-audio` look like it had a production
tree when its `package.json` declares none. All figures below exclude peer edges.

---

## Number 1: 183 alerts are 38 packages

| Grouping                          | Count |
| --------------------------------- | ----- |
| Open alerts                       | 183   |
| Distinct package + manifest pairs | 52    |
| Distinct packages                 | 38    |

GitHub raises one alert per advisory per copy in the tree. `hono` alone accounts for 12 alerts
against a single installed version. The headline number measures advisory volume, not attack surface.

Alert states, for context: 183 open, 207 already fixed, 16 auto-dismissed (406 records total).

## Number 2: where the alerts live

| Manifest                                        | Alerts | Criticals |
| ----------------------------------------------- | ------ | --------- |
| `packages/expo-two-way-audio/package-lock.json` | 85     | 3         |
| `package-lock.json` (root)                      | 97     | 0         |
| `packages/server/package.json`                  | 1      | 0         |

### The 85-alert cluster is a lockfile with no consumer

`packages/expo-two-way-audio` is a vendored Expo native module. Three facts, each independently
sufficient:

1. **It declares no runtime dependencies.** Its `package.json` has an empty `dependencies`, four
   `devDependencies` (`expo-module-scripts`, `expo-modules-core`, `@types/jest`, `@types/react`) and
   three `peerDependencies`. Every one of the 85 alerts is against a transitive dependency of
   `expo-module-scripts`, which is Expo's module build harness.
2. **The root install never reads it.** The package is a member of the root `workspaces` array, so
   `npm ci` at the root resolves it through the root `package-lock.json`. npm ignores nested
   lockfiles inside workspace members. The root lockfile's entry for it lists only the four
   devDependencies.
3. **It is stale against its own manifest.** The nested lockfile records
   `"version": "0.1.97-beta.2"`; the `package.json` beside it says `0.7.5`. It has not been
   regenerated in a long time.

The one workflow that would have used it, `packages/expo-two-way-audio/.github/workflows/ci.yml`,
runs `npm ci` but is inert: GitHub Actions only discovers workflows under the repository-root
`.github/workflows/`, and this checkout's root workflow set does not reference it.

**All 3 criticals are in this cluster**, and all 3 are denial-of-service or weak-randomness issues in
build tooling:

| Advisory            | Package       | CVSS | Summary                                                   |
| ------------------- | ------------- | ---- | --------------------------------------------------------- |
| GHSA-w7jw-789q-3m8p | `shell-quote` | 8.1  | `quote()` does not escape newlines in object `.op` values |
| GHSA-23hp-3jrh-7fpw | `tar`         | 7.5  | Decompression/parse DoS via unlimited input               |
| GHSA-fjxv-7rqg-78g4 | `form-data`   | 0    | Unsafe random function chooses the multipart boundary     |

## Number 3: root lockfile, 97 alerts split by what reaches production

| Class                              | Alerts |
| ---------------------------------- | ------ |
| Reachable through production edges | 71     |
| Dev/build-only                     | 26     |

The 71 is still not the exposure figure, because Expo declares its CLI and build toolchain as
production dependencies of `packages/app`. Resolving each cluster to its parent:

| Cluster                    | Alerts | Enters through                                                                                            | Ships?                                                        |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/app` build chain | 29     | `vitest`, `expo-module-scripts`, `@expo/metro-config`, `eas-cli`, `@expo/cli`, `wrangler`/`miniflare`     | No. Metro bundles from the entry point and never traces these |
| `packages/app` markdown    | 4      | `react-native-markdown-display@7.0.2`                                                                     | **Yes**                                                       |
| `packages/server` (daemon) | 25     | see below                                                                                                 | Loaded, but see reachability                                  |
| `packages/website`         | 11     | `sharp`, `undici`, `ws`, `esbuild`                                                                        | Build and SSR only                                            |
| `packages/desktop`         | 1      | `builder-util-runtime`                                                                                    | Packaging only                                                |
| Dev-only                   | 26     | `wait-on` (19 of them, all `axios`), `app-builder-lib`, `lodash`, `follow-redirects`, `@tootallnate/once` | No                                                            |

The single largest package cluster in the entire report is `axios`, at 19 alerts. Every one arrives
via `wait-on@8.0.5`, a devDependency of `packages/desktop` used to block until the dev server answers.

## Number 4: the daemon, alert by alert

`packages/server` holds workspace file access, terminals and the relay connection, so it gets the
closest read. 25 alerts reach it through production edges. 22 are affirmatively unreachable:

| Alerts | Package                        | Why not reachable                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 13     | `hono`, `@hono/node-server`    | The daemon has **zero** `hono` imports. It arrives under `@modelcontextprotocol/sdk`, whose `server/streamableHttp.js` imports exactly one symbol: `getRequestListener` from `@hono/node-server`. Every one of the 13 advisories is in a middleware or adapter that is never imported: `cors`, `jsx`, `serve-static`, `aws-lambda`, `lambda@edge`, `api-gateway`, `jwt`, `cookie`, `ip-restriction`, `mount`. The daemon does its own CORS in `bootstrap.ts` |
| 6      | `minimatch`, `brace-expansion` | Path is `ejs → jake → filelist → minimatch → brace-expansion`. `jake` is EJS's build tool. EJS's runtime entry `lib/ejs.js` requires only `fs`, `path` and `./utils`; nothing in `ejs/lib/` references `jake`. Installed, never loaded                                                                                                                                                                                                                       |
| 1      | `uuid`                         | GHSA-w5hq-g745-h8pq needs `v3`/`v5`/`v6` with a `buf` argument. The daemon imports only `v4` (50 call sites, all `uuidv4`)                                                                                                                                                                                                                                                                                                                                   |
| 1      | `body-parser`                  | GHSA-v422-hmwv-36x6 needs an invalid `limit` value to silently disable enforcement. `bootstrap.ts` calls `express.json()` with no options, so the 100kb default applies                                                                                                                                                                                                                                                                                      |
| 1      | `qs`                           | GHSA-q8mj-m7cp-5q26 is in `qs.stringify` with `encodeValuesOnly`. `qs` is never imported directly; Express uses it for query **parsing**                                                                                                                                                                                                                                                                                                                     |

Three I will not claim to have ruled out:

- **`fast-uri` ×2** (GHSA-v2hh-gcrm-f6hx, GHSA-4c8g-83qw-93j6, both high, both host confusion).
  `ajv` is a direct daemon dependency and is genuinely instantiated, at
  `packages/server/src/server/agent/agent-response-loop.ts:157`, to validate model structured output.
  `fast-uri` is loaded and runs. Whether the host-confusion bug is _exploitable_ depends on whether a
  security decision is taken from a parsed authority, and Otto validates output **shape**, not
  origins. My read is that impact is very low, but confirming it means reading ajv's `uri` format and
  `$ref` resolution against the schemas Otto actually feeds it. I did not do that.
- **`@ai-sdk/provider-utils`** (GHSA-866g-f22w-33x8, low, uncontrolled resource consumption). Arrives
  via `ai@5.0.78` and is loaded. **No upstream fix exists.**

**Net: 0 of 25 daemon alerts are confirmed reachable; 22 are ruled out by non-import; 3 are
unresolved and all rate low-to-negligible in practice.**

## Number 5: the finding that actually matters

The highest-signal item in the whole report is not critical, and is not in the daemon.

`packages/app` renders every chat message through `react-native-markdown-display@7.0.2`
(`src/components/markdown/renderer.tsx`, `src/components/message.tsx`, `src/components/plan-card.tsx`).
That package pins `markdown-it@10.0.0`, which pins `linkify-it@2.2.0`:

```
packages/app
+-- markdown-it@15.0.0            <- direct dep, current, linkify-it@6.1.0, fine
`-- react-native-markdown-display@7.0.2
    `-- markdown-it@10.0.0
        `-- linkify-it@2.2.0      <- GHSA-v245-v573-v5vm, high, CVSS 7.5
```

GHSA-v245-v573-v5vm is a quadratic-complexity DoS in the `mailto:` validator scan loop, triggered by
**attacker-supplied text**. Chat transcripts are exactly that: model output and pasted user content,
rendered on the primary surface, on both the web build and Electron. A poisoned model response or a
pasted document can hang the render thread. This is the one alert in the set where the vulnerable
code path, the untrusted input and the shipped surface all line up.

The fork already carries `markdown-it@^15.0.0` directly (upstream Paseo is on `^10.0.0`), so the
current copy is only reachable through `react-native-markdown-display`, which last published in 2022.

## Number 6: what is inherited from upstream

| Item                                            | Origin                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/expo-two-way-audio/package-lock.json` | **Inherited.** Present in `upstream/main`. Diff against ours is 2 lines, both the `@getpaseo` to `@otto-code` rename |
| `react-native-markdown-display@7.0.2`           | **Inherited.** Same version upstream                                                                                 |
| `wait-on` / `axios` cluster                     | **Inherited** via `packages/desktop`                                                                                 |
| `ws@^8.21.0` in `packages/server`               | **Fork is ahead.** Upstream is on `^8.14.2`                                                                          |
| `markdown-it@^15.0.0` in `packages/app`         | **Fork is ahead.** Upstream is on `^10.0.0`                                                                          |
| `undici@^7.28.0` in `packages/server`           | **Fork-added.** Upstream declares none                                                                               |

The fork's direct dependency hygiene is already ahead of upstream on the three packages where it
diverges. The two structural problems (the vestigial nested lockfile, the abandoned markdown
renderer) are both upstream's, and both are worth reporting there rather than only patching here.

---

## Retired hypotheses

Recording these so the next person does not re-run them.

- **"The daemon is the most exposed surface, so start there."** Reasonable prior, wrong here. The
  daemon's 25 alerts are the _least_ exploitable group in the report, because `hono` and `ejs`'s
  build chain are installed without ever being imported. The exposed surface was the chat markdown
  renderer in `packages/app`.
- **"`scope: runtime` on the alert tells you whether it ships."** It does not. GitHub reports 156 of
  183 as `runtime`, including all 85 alerts from a package whose `dependencies` object is empty. The
  field reflects the manifest section the _lockfile entry_ sits in, not reachability from a workspace.
- **"npm's `dev: true` lockfile flag is a good enough classifier."** Also insufficient. It is a
  whole-tree property and cannot attribute a package to `packages/server` versus `packages/app`,
  which is the split that decides priority here.
- **"The 3 criticals are the place to start."** They are the lowest-value items in the report: all
  three are in the vestigial lockfile, and all three are DoS or weak-randomness in build tooling.
- **`peerDependencies` must be traversed to model what gets installed.** Traversing them made
  `packages/expo-two-way-audio` (zero declared dependencies) appear to have a production tree and
  inflated `packages/app`. Excluded from all final figures.

## Reproducing

The analysis script is not checked in (per `CLAUDE.md`, no scratch scripts in `src/`). It was written
to a temp path and is reproducible from the description in **Method**: build a forward edge map from
`package-lock.json`'s `packages` object, resolve names with npm's walk-up rule, BFS from each
workspace root with and without dev edges, then match alerts to nodes with
`semver.satisfies(node.version, advisory.vulnerable_version_range)`.

The per-package provenance claims are all one command each:

```bash
npm ls hono @hono/node-server fast-uri qs body-parser --workspace packages/server
npm ls minimatch brace-expansion --workspace packages/server
npm ls markdown-it linkify-it --workspace packages/app
npm ls axios
grep -rhoE "from ['\"]@modelcontextprotocol/sdk[^'\"]*['\"]" packages/server/src | sort | uniq -c
grep -n "hono" node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js
```

## Where the work is tracked

Remediation sequencing is not this document's job. The rows live under
[`projects/README.md`](../../projects/README.md), in **Testing & tooling**.
