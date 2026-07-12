# Ingesting upstream Paseo changes

Otto is a fork of [Paseo](https://github.com/getpaseo/paseo) with full upstream
history preserved. The `upstream` remote points at the Paseo repo, so upstream
changes are ingested with a normal `git merge` — plus a rebrand pass, because
every upstream change that mentions "paseo" must be translated to Otto naming.

The rebrand is purely rule-based (see `scripts/rebrand-upstream.pl`), which makes
merges mechanical: when in doubt, take upstream's version of a hunk and re-run
the rules on it.

## The naming map

| Upstream                                      | Otto                                                             |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `Paseo` / `paseo` (prose, identifiers)        | `Otto` / `otto`                                                  |
| `@getpaseo/*` npm scope                       | `@otto-code/*`                                                   |
| `getpaseo/paseo` GitHub repo                  | `Draek2077/otto-code`                                            |
| `getpaseo` org                                | `Draek2077`                                                      |
| `paseo.sh` domain                             | `otto-code.me`                                                   |
| `PASEO_*` env vars                            | `OTTO_*`                                                         |
| `sh.paseo` / `.debug` / `.desktop` bundle ids | `ai.ottocode` / `.debug` / `.desktop` (no hyphens — reverse-DNS) |
| `paseo` CLI command                           | `otto`                                                           |
| `~/.paseo` data dir, `paseo.json` config      | `~/.otto`, `otto.json`                                           |
| Default daemon port `6767`                    | `6868`                                                           |

## Merge procedure

```bash
git fetch upstream
git checkout -b merge/upstream-$(date +%Y-%m) main
git merge upstream/main
```

### 1. Resolve conflicts

For each conflicted file, prefer upstream's side of the hunk (it has their new
logic), then re-apply the rebrand rules to that file:

```bash
git checkout --theirs <file>
perl -CSD scripts/rebrand-upstream.pl <file>
git add <file>
```

Only hand-merge when Otto has made _functional_ (not naming) changes to the
same lines.

### 2. Rebrand anything new

Upstream additions that didn't conflict can still carry paseo naming (new files,
new env vars, new docs). Run the script over everything the merge touched:

```bash
git diff --name-only HEAD@{1} HEAD -- | xargs perl -CSD scripts/rebrand-upstream.pl
```

Rename any new paseo-named files/dirs:

```bash
git ls-files | grep -i paseo   # then git mv each, applying Paseo->Otto / paseo->otto
```

### 3. Audit — must be clean before committing

```bash
git grep -ilE 'paseo|getpaseo' -- \
  ':!LICENSE' ':!NOTICE' ':!README*' ':!CHANGELOG.md' \
  ':!CLAUDE.md' ':!docs/upstream-merges.md' ':!docs/fork-release-guide.md' \
  ':!scripts/rebrand-upstream.pl' \
  ':!packages/website/src/components/landing-page.tsx' \
  ':!packages/website/src/components/site-footer.tsx' \
  ':!packages/website/src/routes/index.tsx' \
  ':!packages/website/src/routes/sponsor.tsx' \
  ':!packages/app/src/styles/theme.ts' \
  ':!packages/app/src/utils/upstream-base-version.ts'
```

Expected output: **nothing**. The excluded files keep Paseo references on
purpose:

- `LICENSE`, `NOTICE`, and the README credits — AGPL attribution.
- `CLAUDE.md`, `docs/upstream-merges.md`, `docs/fork-release-guide.md`, and
  `scripts/rebrand-upstream.pl` — they document the fork relationship and the
  rebrand rules themselves.
- The website landing/footer/sponsor pages — public "built on Paseo" credit
  and the sponsorship page pointing at upstream's author.
- `packages/app/src/styles/theme.ts` — comments recording which themes are
  inherited from upstream.
- `packages/app/src/utils/upstream-base-version.ts` — the single source of the
  upstream base name + version shown in Settings → About. It is Otto-only (so
  the rebrand pass never touches it) and deliberately holds the "Paseo" literal
  so the display code and i18n never have to. Bump its version in step 4 below.

Anything outside this list must be Otto. If a merge adds a new intentional
reference (e.g. more credit copy), add it to the exclusion list here in the
same commit.

Also check the port didn't sneak back:

```bash
git grep -n '\b6767\b' -- ':!*package-lock.json'
```

### 4. Bump the upstream base version

Every upstream merge **must** update `UPSTREAM_BASE_VERSION` in
`packages/app/src/utils/upstream-base-version.ts` to the Paseo release this merge
ingests. That constant is the single source of the "Based on Paseo vX.Y.Z" line
shown in Settings → About next to the Otto app version, so users can tell which
upstream fixes are under the hood — a stale value silently misreports the base.

Only the version changes; `UPSTREAM_BASE_NAME` stays `"Paseo"`. Read the number
from the upstream tip you're merging (works during or after the merge):

```bash
git show MERGE_HEAD:package.json | grep -m1 '"version"'      # during the merge
git show upstream/main:package.json | grep -m1 '"version"'   # or from the fetched tip
git describe --tags upstream/main                            # sanity-check the tag
```

This is why the file is on the audit exclusion list in step 3 — it is the one
place the "Paseo" literal is allowed to live. Do not move the name/version into
the display code or i18n strings; the rebrand pass would rewrite them on the next
merge that touches those files.

### 5. Regenerate lockfiles and verify

```bash
npm install --package-lock-only
npm run typecheck
npm run lint
```

Then merge the branch into `main`.

## Script gotchas (learned the hard way)

- **Third-party links stay upstream-named.** Community projects like
  `paseo-relay` and `paseo-vscode` are real external URLs — rebranding them
  breaks the links. Check README/community references after running the script.
- **The `6767` rule can mangle lookalikes.** It once rewrote a test UUID
  containing `-6767-` segments. After a merge, scan for accidental `6868`
  inside UUIDs/hashes: `git grep -nE '6868-6868'`.
- **Bundle ids must stay hyphen-free.** Never let `sh.paseo` map to anything
  containing `otto-code` — reverse-DNS segments cannot contain hyphens.
- **`LICENSE` is never rewritten.** The upstream copyright notice must remain
  verbatim (AGPL requirement). The script is simply never run against it.

## Cadence

Merge upstream regularly (roughly every upstream release). Small, frequent
merges keep conflicts trivially rule-resolvable; letting drift accumulate turns
naming conflicts into real ones — especially once Otto's autonomous-IDE changes
start rewriting the same subsystems upstream is evolving.
