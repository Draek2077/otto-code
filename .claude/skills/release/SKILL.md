---
name: release
description: Cut a release of Otto — the one streamlined runbook. Default is a stable patch. Use when the user says "release", "release otto", "ship", "ship stable", "cut a release", "new version", "release:patch", "promote", "release beta", or "/release". Handles stable-patch (default), beta, and promote in one place.
user-invocable: true
---

# Release

The self-contained release runbook. **Follow this skill directly — do not re-read `docs/release.md` for a normal release.** `docs/release.md` is the exhaustive reference; come back to it only for the edge cases flagged below (rollout tuning, retrying a failed build). This keeps a release token-light.

**Default = stable patch.** "Release", "ship", "ship stable", "release otto" all mean a patch bump from the previous stable. Only run the beta path when the user explicitly says "beta". Never bump minor/major to trigger or retry a build — that needs an explicit "minor"/"major" from the user.

## The two-step safety gate (applies always)

1. **Preparation** (agent does this — local, reversible): pre-flight checks, draft changelog, sanity check. Show findings, wait.
2. **Go-ahead** (only after the user says "go ahead" / "ship it"): commit the changelog, run the release command.

Invoking this skill is intent to _start_, not authorization to publish. If the user asks for a **preview**, show the prospective changelog and answer questions — do **not** commit, tag, or run any `release:*` command until they explicitly authorize. Last-minute changes always need approval. A sanity-check finding is information, not a directive — surface it, the user decides.

---

## Stable patch (the 95% path)

### 1. Pre-flight (agent, reversible)

Run from a clean tree on `main`, on the exact commit to be released:

```bash
npm run format && npm run lint && npm run typecheck   # all green; commit any format churn on its own
npm run acp:version-drift:check                        # if drift is intentional, say so; else: npm run acp:version-drift:update && commit
npm run release:prepare                                # run once alone to absorb any package-lock churn into a normal commit
```

Why `release:prepare` first: it runs `npm install --workspaces`, which can churn `package-lock.json`. `version:all:*` aborts on a dirty tree, and the pre-commit hook rejects a lockfile-only commit. Absorbing the churn now avoids a mid-release mess.

### 2. Draft the changelog (agent writes it — never hand it off)

- Heading is **strict**: `## X.Y.Z - YYYY-MM-DD` — no `v`, no extra text. A malformed heading breaks Release Notes Sync.
- Draft from the `v<previous-stable>..HEAD` diff. Covers the **full** delta from the previous stable.
- **User-facing voice**, not implementation. Describe what changed in the app, not the code. No component/module names, no "remount / virtualized / debounced / memoized".
- One sentence per bullet, no trailing periods, one line each. Split any bullet that chains changes with "and"/commas/em-dash. Collapse intra-release fixes (if a feature was added _and_ fixed this release, list only the working feature).
- Order by user impact: features → quality-of-life → internal-with-user-benefit.
- **Attribution** — credit external commit _authors_ (not the PR opener), skip [@boudra](https://github.com/boudra). Link PRs to `Draek2077/otto-code`:
  ```bash
  git log --format='%H %s' v<previous>..HEAD | grep -E '\(#[0-9]+\)$'   # find PR numbers
  gh pr view N --repo Draek2077/otto-code --json commits --jq '[.commits[].authors[].login] | unique | .[]'   # authors
  ```
  Format: `([#123](https://github.com/Draek2077/otto-code/pull/123) by [@user](https://github.com/user))`.

Show the drafted entry to the user and **wait for approval**. Do not commit it yet.

### 3. Pre-release sanity check (stable only)

Review `git diff <latest-release-tag>..HEAD` as a last line of defence. Focus on: protocol breaks (WebSocket / agent lifecycle / server↔client), **old app client vs. new daemon** back-compat (users update daemon first, keep the old app), and regressions. Surface anything risky; the user decides.

### 4. Go-ahead → commit + release

Only after explicit go-ahead:

```bash
# Commit the approved changelog on its OWN commit — no code bundled in.
git commit -m "docs(changelog): add X.Y.Z release notes"

# Confirm prerequisites, then cut it.
npm whoami                    # must be an otto-code npm org member
npm run release:patch         # release:check → version:all:patch (bump+commit+tag) → release:publish → release:push
```

`release:patch` bumps every workspace, publishes the six `@otto-code/*` packages, and pushes HEAD + tag. The tag push triggers CI (see step 5).

**If publish fails mid-chain** (auth expired, registry hiccup): the version commit + tag exist but are unpushed. Don't re-run the full chain — resume with `npm run release:publish` then `npm run release:push`.

### 5. Done — `release:push` is the last step

**Do NOT watch the builds.** No background polling loop, no `gh run list` heartbeat, no scheduled re-check, no "I'll report back when they settle." The user watches CI themselves and has ruled the monitoring a waste of tokens. Report what shipped and end the turn.

The `v*` tag push triggers, in **your** repo: `Desktop Release`, `Android APK Release`, `Android Play Release` (AAB → Play internal track), `Docker`, `Deploy App` (web app), `Release Notes Sync`. `Deploy Website` runs when the GitHub release publishes (stable only).

- **`gh` defaults to upstream Paseo here — always pass `--repo Draek2077/otto-code`** — for the one-off checks below, or when the user asks about a specific failure later.
- macOS desktop jobs **run and produce unsigned artifacts** (they no longer skip for want of Apple signing — changed as of 0.6.6). A red mac job is a **real failure**, not an expected skip. Unsigned means a Gatekeeper warning on first open; that is the known trade, not a defect.
- Spot-check once, if at all: `npm view @otto-code/cli version` shows the new version on `latest`.

Stable rollout is a 36h staged ramp by default; nothing extra needed. To admit everyone immediately or tune the ramp, see **`docs/release.md` → "Staged rollout"**.

---

## Beta path (only when the user says "beta")

Betas are fast release candidates on the `beta` channel: npm publishes on the `beta` dist-tag only, the website download target does not move, and **the sanity check is skipped** (the beta is the smoke test).

```bash
npm run release:beta:patch    # → X.Y.Z-beta.1: check, bump, publish beta dist-tag, push tag
# ...smoke desktop + APK prerelease assets from GitHub Releases...
npm run release:beta:next     # optional: cut beta.2, beta.3, ...
npm run release:promote       # promote X.Y.Z-beta.N → stable X.Y.Z (fresh v* tag)
```

Beta changelog: keep **one** in-place `## X.Y.Z-beta.N - YYYY-MM-DD` entry that always covers the full previous-stable→HEAD delta. Each beta bumps that same heading; promotion overwrites it in place (heading → `X.Y.Z`, date → promotion day). Never leave a stale `-beta.N` heading or append a new per-beta entry. Verify npm: `npm view @otto-code/cli dist-tags` (version under `beta`, not `latest`).

Promotion runs the **stable** completion checklist, including the sanity check.

---

## Hard rules

- **Never bump minor/major to fix or retrigger a build.** Build/CI failures are fixed on the current version. To rebuild a target, push a retry tag — see `docs/release.md` → "Fixing a failed release build" (Docker-only retries use `docker.yml` dispatch, never a re-pushed `v*` tag).
- **No code in the changelog commit or the release commit.** Code shims are their own reviewed commit.
- **"Stable" means stable** — don't offer a beta first when the user said stable.
- **Releases are always patch** unless the user explicitly says "minor"/"major".

## When to open `docs/release.md`

Only for these — everything else is above:

- Staged rollout tuning: instant-admit, `desktop-rollout.yml`, custom ramps, releasing during an active rollout.
- Fixing a failed build: retry-tag patterns (`desktop-vX.Y.Z`, `android-vX.Y.Z`, per-platform), Docker dispatch, why `workflow_dispatch` won't pick up tagged code fixes.
- Watching EAS builds from the terminal; the full completion checklists.
