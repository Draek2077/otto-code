---
id: "personal-git-config-silently-emptied-every-diff-in-the-changes-view"
kind: "finding"
title: "Personal git config silently emptied every diff in the Changes view"
status: "proposed"
tags: ["git","diff","changes-view","bug"]
created_at: "2026-08-20T21:45:37.474Z"
updated_at: "2026-08-20T21:45:37.474Z"
---
# Personal git config silently emptied every diff in the Changes view

<!-- compiled_truth -->

A user's own git config could empty the entire Changes view, in both Line and Structural presentations, for every file. `diff.mnemonicPrefix = true` in a developer's `~/.gitconfig` reshapes patch headers from `a/path b/path` to `c/path w/path`, so the daemon's patch parser keyed each file under `w/<path>`, missed the lookup against the real changed path, and emitted the file with `hunks: []` and `status: "ok"`. The same silent-and-total failure came from custom `diff.srcPrefix`/`dstPrefix`, `color.ui = always`, and any `diff.external` driver (difftastic, delta, meld). It reads as a rendering bug rather than a git-config one because file rows and their `+N/-N` counts come from `--name-status` and `--numstat`, which none of those settings affect, so the list looks perfectly correct beside a blank pane. Fixed in two layers: `runGitCommand` now pins machine-readable config on every git invocation (alongside the pre-existing `core.quotepath=false`) and patch-producing commands pass `--no-ext-diff --no-textconv`, while `parseDiff` derives the header prefix instead of assuming `a/`/`b/` so patches produced elsewhere (agent tool output, forge patches, pastes) also survive. The user's own `git diff` is deliberately left alone.

## Timeline

- time: "2026-08-20T21:45:37.474Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["diff-review-experience","structural-diff-review-experience"]
- time: "2026-08-20T21:45:37.474Z"
  kind: "evidence"
  summary: "Reported 2026-08-20: a developer saw every file in Changes render an empty diff, both presentations, while file rows and diff stats looked right. `git config --show-origin --get-regexp '^(diff|color)\\.'` showed `diff.mnemonicprefix true` from `~/.gitconfig`, and `git diff HEAD -- PRISM.md` confirmed the header shape `diff --git c/PRISM.md w/PRISM.md`.\n\nRoot cause reproduced by running that exact header through the daemon parser: `parseDiff` returned `path: \"w/PRISM.md\"` instead of `\"PRISM.md\"`. The parsed-file lookup in `appendStructuredTrackedDiffs` (packages/server/src/utils/checkout-git.ts) is by real path, so it missed and fell through to the `hunks: []`, `status: \"ok\"` branch, which the client renders as an empty body.\n\nLocal git experiments (git 2.53.0) established the fix surface: `-c diff.mnemonicPrefix=false -c diff.noprefix=false` restores `a/ b/` even with the user's setting on, `--no-color` defeats `color.ui = always`, and `--no-ext-diff` defeats `diff.external`. `diff.external` cannot be neutralized by config: `git -c diff.external= diff` exits with \"error: cannot run : No such file or directory / fatal: external diff died\". Rename headers were confirmed to carry prefix-free `rename from` / `rename to` lines, and spaced paths are emitted unquoted with a trailing tab on the `---`/`+++` lines.\n\nRegression coverage: packages/server/src/utils/checkout-git.user-git-config.test.ts, one case per setting (mnemonic prefix, custom src/dst prefixes, external driver, forced color). All four cases were verified to fail against the pre-fix sources (stashed) and pass after. Parser-level cases live in both diff-highlighter test files. Durable half documented in docs/changes-view.md."
