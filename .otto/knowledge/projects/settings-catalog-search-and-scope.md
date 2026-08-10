---
id: "settings-catalog-search-and-scope"
kind: "project"
title: "Settings catalog, scope, and search"
status: "proposed"
tags:
  [
    "settings",
    "information-architecture",
    "search",
    "app",
    "desktop",
    "host",
    "user-mode",
    "developer-mode",
  ]
delivery_status: "charter"
created_at: "2026-08-10T01:00:02.708Z"
updated_at: "2026-08-10T01:00:02.708Z"
---

# Settings catalog, scope, and search

<!-- compiled_truth -->

## Problem

The Settings UI presents App and Host groups, but the persistence model has three scopes: device-local App settings, Electron Desktop settings, and daemon-owned Host settings. Users also need a consistent way to distinguish User versus Developer controls and Essential versus Advanced visibility.

## Scope

- Maintain a complete registry of settings and setting groups.
- Declare scope (App, Desktop, Host), audience (User, Developer), visibility (Essential, Advanced, Action, Informational), category, platform, feature gate, description, and search aliases.
- Validate that writable UI fields map to one real persistence path and that every registry entry is rendered or intentionally action-only.
- Add full-catalog search that can find hidden Developer/Advanced settings without exposing secret values.
- Make Desktop settings and saved host connection records explicit in the information architecture.

## Outcomes

- Users see a smaller, comprehensible default settings surface.
- Developers can reach the complete host and performance configuration.
- Search results explain why a result is hidden or which scope it affects.
- Security, credential, destructive, and lifecycle controls remain discoverable and receive appropriate warnings.

## Acceptance criteria

- No setting is classified only by its visual page location; classification is backed by persistence ownership.
- App, Desktop, and Host scope are visible in the UI wherever a setting can affect another client or process.
- User mode, Developer mode, and Advanced reveal behavior are deterministic and covered by tests.
- Search indexes labels, descriptions, aliases, category, scope, and audience, but never secret values.
- Registry coverage tests detect missing, duplicate, or stale setting definitions.

## Timeline

- time: "2026-08-10T01:00:02.708Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["architecture"]
- time: "2026-08-10T01:00:02.708Z"
  kind: "evidence"
  summary: "Static inventory completed 2026-08-09 from packages/app/src/screens/settings\*, packages/app/src/hooks/use-settings, packages/app/src/desktop/settings/desktop-settings.ts, packages/protocol/src/messages.ts, and packages/app/src/i18n/resources/en.ts. Findings report: findings/settings-catalog/2026-08-09-settings-ownership-and-visibility.md."
