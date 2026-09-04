---
id: "finding-2026-09-03-codeql-execution-sink-triage"
kind: "finding"
title: "CodeQL's command and code-construction findings do not show an unapproved production execution path"
status: "proposed"
tags: ["finding","security","codeql","command-injection","code-injection"]
created_at: "2026-09-04T03:49:59.128Z"
updated_at: "2026-09-04T03:49:59.128Z"
---
# CodeQL's command and code-construction findings do not show an unapproved production execution path

<!-- compiled_truth -->

## Scope

A live CodeQL query on 2026-09-03 returned 56 open alerts against `refs/heads/main` at `530fdef35e86ba8ab3f34d555954828f4b1bf785`. This finding evaluates the ten command/code-construction alerts, not the unrelated Dependabot advisory set.

## Command and code-construction result

None of the ten alerts establishes an unapproved production command- or code-injection route.

- Alerts 18, 19, 20 and 74 are `execSync` calls in E2E/runtime test code.
- Alert 23 traces `OTTO_HOME` through the shared launcher. `resolveOttoHome` resolves a local environment path; `spawnProcess` defaults to `shell: false`, and the Windows `.cmd` path invokes `cmd.exe` with individually quoted argv.
- Alert 24 traces the local speech-model directory into a `tar` extraction. The model id is a typed catalog id, the downloaded archive is SHA-256 verified, and extraction calls `spawnProcess(tar, ["xf", archivePath, "-C", destDir])` without a shell.
- Alert 66 is CodeQL's aggregate sink at the shared launcher. It includes the paths above and test paths, not evidence that a real caller passes untrusted text to a shell.
- Alerts 25 and 26 are in the desktop capture harness, which constructs CDP test expressions from harness-owned references and fingerprints serialized with `JSON.stringify`.
- Alert 77 is the Mermaid isolated-webview bootstrap. Its `runtimeHtml` comes from a checked-in generated runtime module and the bridge prefix is a constant, both serialized with `JSON.stringify`.

## Deliberate execution boundary

Preview launch configurations are an intentional shell-execution surface: `DevServerManager` starts the project's configured executable and args with `shell: true`. This is documented in `docs/preview.md`; for OpenAI-compatible agents, the preview-start gate snapshots commands at session start and requires approval if a configuration was added or changed. It is not one of the CodeQL alerts and must remain treated as a permission boundary.

## Remaining CodeQL work

The remaining alerts should be triaged by surface rather than severity label. The largest non-vendor groups are Brain TLS trust choices, daemon rate-limit warnings, and local-input regex complexity warnings. The 56-alert set also includes vendored `archify`, test, demo, and capture-harness files. Those require separate fix-or-dismiss decisions, but they are not proof of code injection.

## Recommended next step

Review and classify the non-command first-party groups, then make explicit CodeQL dismissals for test/vendor findings with evidence. Do not suppress the Preview launch gate or replace argv-based process launches with a blanket shell allowance.

## Timeline

- time: "2026-09-04T03:49:59.128Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["finding-2026-09-03-appimage-code-execution-dependabot","release-0-9-product-completion"]
- time: "2026-09-04T03:49:59.128Z"
  kind: "evidence"
  summary: "GitHub API details for CodeQL alerts 18, 19, 20, 23, 24, 25, 26, 66, 74 and 77 were read on 2026-09-03. Alert metadata identifies the exact files and CodeQL traces. First-party source review covered `packages/server/src/utils/spawn.ts`, `packages/server/src/utils/windows-command.ts`, `packages/server/src/server/otto-home.ts`, `packages/server/src/server/speech/providers/local/sherpa/model-downloader.ts`, `packages/desktop/capture-harness/main.js`, `packages/app/src/components/markdown/fence/mermaid/host.web.tsx`, and `packages/server/src/server/preview/dev-server-manager.ts`. `docs/preview.md` documents the launch-config approval boundary."
