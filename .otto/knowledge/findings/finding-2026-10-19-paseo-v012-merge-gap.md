---
id: "finding-2026-10-19-paseo-v012-merge-gap"
kind: "finding"
title: "Paseo v0.8.0 to v0.12.0: where the merge conflicts actually are"
status: "proposed"
tags: ["upstream","paseo","merge","drift"]
created_at: "2026-10-19T19:13:21.101Z"
updated_at: "2026-10-19T19:13:21.101Z"
---
# Paseo v0.8.0 to v0.12.0: where the merge conflicts actually are

<!-- compiled_truth -->

As of 2026-10-19 Otto's last upstream merge is Paseo v0.8.0 (b8e24677e, merged 2026-09-13). Paseo v0.12.0 (cafe4b01c) shipped 2026-10-19: 658 commits, four minor releases, twice the cadence cap in docs/upstream-merges.md.

Most of the conflict surface is in files Otto genuinely customized, not rebrand noise. Of 1,246 files both sides changed, 299 (24%) are rebrand-only on Otto's side and merge mechanically; 359 have light Otto edits (1 to 20 lines), 386 moderate (21 to 200), and 170 heavy (over 200, carrying 175k Otto lines against 47k upstream lines). Source-only, the contested load concentrates in app/components, app/screens, the server session and agent providers, the client, and the composer.

The hard part is not volume but six places where upstream replaced or moved an owner Otto had built on: (1) the Markdown engine swap to react-native-enriched-markdown in v0.12.0 (#6973), which removes the markdown-display `rules` seam that Otto's comment locators, Knowledge heading navigation, table borders, rendered-preview find, task lists, footnotes and math all use; (2) the voice audio engine move to app/src/audio with a signal-based play() (v0.11.0, #5976) under Hey Otto and gain channels; (3) usage fetchers becoming built-in plugins (v0.11.0, #5465) where Otto added OAuth token write-back; (4) the Settings page split (v0.10.0, #5459) against Otto's search-first overview and settings inventory; (5) the scripts button move (v0.12.0, #7122) and Explorer tab unification (v0.11.0, #5942); (6) structural refactors of session.ts, daemon-client.ts and workspace-screen.tsx where Otto's delta is mostly additive.

One jump to v0.12.0 resolves 915 contested files once; stepping per minor release costs 1,523 file resolutions, and v0.11.0 then v0.12.0 costs 1,215. Every one of the six owner changes except Markdown, scripts and the phone layout lands by v0.11.0.

## Timeline

- time: "2026-10-19T19:13:21.101Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["paseo-v012-upstream-integration","upstream-mergeability-through-otto-owned-seams"]
- time: "2026-10-19T19:13:21.101Z"
  kind: "evidence"
  summary: "Method, 2026-10-19:\n- `node scripts/upstream-status.mjs --at v0.12.0 --verbose`: 658 commits, 2,762 upstream files, 1,221 both-sides files, 1,135 clean new files, 47 delete/modify hazards, 42 hand-merge hotspots.\n- Brand-normalized classifier (.tmp script using `normalizeBrand` from scripts/merge-integration-analysis.mjs and diffLines): per overlap file, Otto lines changed beyond the rebrand. Tiers: rebrand-only 299 files (15,978 upstream lines), light 359 (29,366 / Otto 3,090), moderate 386 (41,595 / Otto 29,687), heavy 170 (46,932 / Otto 175,301), Otto-deleted 32. 12 additional overlaps hide behind Otto path renames (paseo-home.ts, paseo-tools.ts, paseo-worktree-service.ts, skills/paseo*).\n- Largest two-sided rewrites (Otto / upstream lines): session.ts 5,568 / 2,493; daemon-client.ts 5,893 / 1,479; workspace-screen.tsx 4,084 / 1,103; new-workspace-screen.tsx 1,034 / 1,599; message.tsx 2,417 / 1,024; claude/agent.ts 3,577 / 938; markdown/renderer.tsx 888 / 888.\n- Raw `git merge-tree --write-tree HEAD <tag>` conflicts: v0.9.0 363, v0.10.0 435, v0.11.0 605, v0.12.0 747 (673 content, 71 modify/delete). Hunks: workspace-screen.tsx 63, session.ts 47, settings-screen.tsx 39, daemon-client.ts 31.\n- Step cost (contested files touched per step, summed): per-minor 1,523; v0.10.0+v0.12.0 1,224; v0.11.0+v0.12.0 1,215; single jump 915. 390 contested files change in two or more upstream releases.\n- Markdown: enriched-markdown 1.2.0 nightly with a 2,930-line local patch; custom renderers exist only on web for codeBlock and link; md4c exposes no source positions. TTS (daemon-side speech-text.ts), the Matrix effect, and HTML/PDF export were verified independent of the renderer.\n- Rival-feature audit of the 0.9.0 to 0.12.0 changelog recorded in the project page paseo-v012-upstream-integration.\nHypotheses not yet verified: whether md4c math can be enabled on native; whether table single-owner borders are expressible through markdownStyle; whether the Hey Otto handoff survives #7200's Android interruption handling; whether Otto replies emitted outside a request context survive #4596's owned-subscription delivery."
