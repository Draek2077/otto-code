---
id: "openai-compatible-and-brain-model-visibility-is-host-configurable"
kind: "requirement"
title: "OpenAI-compatible and Brain model visibility is host-configurable"
status: "confirmed"
tags: ["models","providers","brain","settings","visibility"]
created_at: "2026-08-25T14:05:41.856Z"
updated_at: "2026-08-25T14:05:41.856Z"
---
# OpenAI-compatible and Brain model visibility is host-configurable

<!-- compiled_truth -->

Host owners can choose which OpenAI-compatible and Otto Brain models appear in model-picking surfaces from each provider's searchable Models settings. Every discovered and custom model remains present in the management list with a visibility checkbox before its name, and Show all / Hide all actions sit outside the list for bulk management. Visibility defaults to shown, persists across catalog refreshes, and hiding a model does not invalidate existing agents or profiles that already reference its model ID.

## Timeline

- time: "2026-08-25T14:05:41.856Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["finding-2026-08-09-settings-ownership-and-visibility","brain-profile-selection-and-editor-ux","brain-catalog-uses-plain-model-names-and-prose"]
- time: "2026-08-25T14:05:41.856Z"
  kind: "evidence"
  summary: "Implemented through the backward-compatible `AgentModelDefinition.isVisible` snapshot field and daemon-owned `agents.modelVisibilityOverrides` configuration. Provider snapshots retain the full catalog for Settings while app picker filters exclude only `isVisible: false`. Verified by targeted protocol tests (45 passing), server persistence/snapshot tests (96 passing before final focused rerun; provider snapshot file 55 passing after final edits), client tests (10 passing), app visibility/search/i18n tests (56 passing), successful `npm run build:server`, targeted lint with zero findings, and typechecks for protocol, client, server, and app."
