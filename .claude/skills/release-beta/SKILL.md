---
name: release-beta
description: Cut a beta release of Otto. Use when the user says "release beta", "cut a beta", "ship a beta", "beta release", or "/release-beta". Betas are release candidates on the beta channel — they carry an in-place changelog entry, don't move the website download target, and publish npm only on the beta dist-tag.
user-invocable: true
---

# Release beta

Use the **`release`** skill (`.claude/skills/release/SKILL.md`) — it is the single, token-light runbook. Follow its **Beta path** section: `release:beta:patch` → iterate `release:beta:next` → `release:promote`, with one in-place `## X.Y.Z-beta.N` changelog entry (overwritten at promotion) and npm on the `beta` dist-tag only.

Do not read `docs/release.md` for a normal beta; the `release` skill is self-contained.
