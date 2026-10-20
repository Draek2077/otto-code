---
id: "finding-2026-09-03-appimage-code-execution-dependabot"
kind: "finding"
title: "0.9.0 AppImage build inherits a local code-execution condition from app-builder-lib"
status: "proposed"
tags: ["finding","security","dependency-vulnerabilities","release-packaging"]
created_at: "2026-09-04T03:43:15.901Z"
updated_at: "2026-09-04T03:43:15.901Z"
---
# 0.9.0 AppImage build inherits a local code-execution condition from app-builder-lib

<!-- compiled_truth -->

## Observation

A live Dependabot recheck on 2026-09-03 reports `GHSA-7g7r-gx96-252g` against `app-builder-lib` in the root lockfile. The checkout resolves `electron-builder@26.8.1` and `app-builder-lib@26.8.1`; the advisory is fixed in `app-builder-lib@26.15.0`.

Otto's desktop build declares Linux `AppImage` as a release target in `packages/desktop/electron-builder.yml`. The advisory describes an `AppRun` script that can leave an empty `LD_LIBRARY_PATH` component. If a victim starts the affected AppImage from a directory where an attacker can place a shared library, the dynamic linker can load that library and execute it as the victim.

This is a build-time dependency with a runtime consequence in a shipped artifact, so the existing `scripts/audit-shipped.mjs` production-closure gate does not cover it. The observation does not establish remote exploitation of Otto; it establishes a release-packaging code-execution condition for AppImage artifacts.

## Other injection-oriented alerts rechecked

- The critical `shell-quote` alert is confined to the stale nested lockfile in `packages/expo-two-way-audio`; first-party code does not import it.
- The Babel SystemJS advisory requires compiling attacker-controlled code with the SystemJS transform. No first-party SystemJS configuration or import was found.
- The Lodash `_.template` code-injection advisory has no first-party call site; its installed copies arrive through packaging/dev tooling.
- The daemon uses Undici `fetch` plus `Agent` dispatchers, not the affected low-level request, cookie, cache, retry, or upgrade APIs.
- `js-yaml` is first-party imported only by release-manifest scripts; the listed advisories are CPU/prototype-pollution classes, not code execution.

## Recommended next step

Before publishing a release that contains an AppImage, update `electron-builder` so its `app-builder-lib` resolution is at least `26.15.0`, rebuild an AppImage, and inspect its generated `AppRun` environment construction. Treat this as a targeted packaging remediation, not a reason to bulk-update the 164 open alerts.

## Timeline

- time: "2026-09-04T03:43:15.901Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["finding-2026-08-02-dependabot-alert-triage","finding-2026-08-02-shipped-advisory-closure","release-0-9-product-completion"]
- time: "2026-09-04T03:43:15.901Z"
  kind: "evidence"
  summary: "Live GitHub API query on 2026-09-03: `GET /repos/Draek2077/otto-code/dependabot/alerts?state=open` returned 164 open alerts (1 critical, 80 high, 70 medium, 13 low). Alert `GHSA-7g7r-gx96-252g` states `app-builder-lib < 26.15.0` is vulnerable and fixed in 26.15.0. Local `npm explain app-builder-lib --workspace @otto-code/desktop` resolves it from `electron-builder@26.8.1`; `packages/desktop/electron-builder.yml` targets AppImage. Source searches found no first-party SystemJS transform, lodash template, or shell-quote use. Undici imports in first-party daemon code are fetch/Agent only. The existing weekly gate's source confirms it walks production dependencies, excluding the Electron build chain."
