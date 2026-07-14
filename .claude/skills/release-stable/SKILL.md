---
name: release-stable
description: Cut a stable release of Otto (fresh patch or promote from beta). Use when the user says "release stable", "ship stable", "promote", "release:patch", "release:promote", or "/release-stable".
user-invocable: true
---

# Release stable

Use the **`release`** skill (`.claude/skills/release/SKILL.md`) — it is the single, token-light runbook and its default path is exactly this: a stable patch. For a promote-from-beta, follow that skill's **Beta path → promote** step.

Do not read `docs/release.md` for a normal release; the `release` skill is self-contained and points you to the doc only for the edge cases (rollout tuning, retrying a failed build).
