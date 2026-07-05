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
| `getpaseo/paseo` GitHub repo                  | `otto-code-ai/otto-code`                                         |
| `getpaseo` org                                | `otto-code-ai`                                                   |
| `paseo.sh` domain                             | `otto-code.ai`                                                   |
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
git grep -ilE 'paseo|getpaseo' -- ':!LICENSE' ':!NOTICE' ':!README*' ':!CHANGELOG.md' ':!docs/upstream-merges.md'
```

Expected output: **nothing**. `LICENSE`, `NOTICE`, and the README credits
intentionally keep Paseo references for AGPL attribution; everything else must
be Otto.

Also check the port didn't sneak back:

```bash
git grep -n '\b6767\b' -- ':!*package-lock.json'
```

### 4. Regenerate lockfiles and verify

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
