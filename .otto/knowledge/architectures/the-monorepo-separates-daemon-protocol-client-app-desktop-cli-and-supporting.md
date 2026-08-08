---
id: "the-monorepo-separates-daemon-protocol-client-app-desktop-cli-and-supporting"
kind: "architecture"
title: "The monorepo separates daemon, protocol, client, app, desktop, CLI, and supporting packages"
status: "superseded"
tags: ["architecture", "monorepo", "packages", "boundaries"]
created_at: "2026-08-08T03:27:27.708Z"
updated_at: "2026-08-08T05:16:39.353Z"
---

# The monorepo separates daemon, protocol, client, app, desktop, CLI, and supporting packages

<!-- compiled_truth -->

The repository is an npm-workspaces monorepo whose package boundaries separate the server daemon, shared protocol schemas, client library, Expo app, Electron desktop wrapper, CLI, relay, website, brain, visualizer, and supporting packages.

## Timeline

- time: "2026-08-08T03:27:27.708Z"
  kind: "created"
  summary: "Knowledge page created."
- time: "2026-08-08T05:06:24.112Z"
  kind: "evidence"
  summary: "package.json lists the workspace packages. docs/architecture.md defines responsibilities and dependency direction for packages/server, protocol, client, app, cli, relay, desktop, and website."
  source: "Legacy Markdown evidence section"
- time: "2026-08-08T05:06:24.112Z"
  kind: "migration"
  summary: "Migrated from legacy page id 1cc0388c-8cb1-4e25-b182-525eed60fbdf to the-monorepo-separates-daemon-protocol-client-app-desktop-cli-and-supporting-pac."
- time: "2026-08-08T05:14:18.311Z"
  kind: "migration"
  summary: "Migrated from legacy page id the-monorepo-separates-daemon-protocol-client-app-desktop-cli-and-supporting-pac to the-monorepo-separates-daemon-protocol-client-app-desktop-cli-and-supporting."
- time: "2026-08-08T05:16:39.353Z"
  kind: "reversal"
  summary: "Onboarding review found this claim is already canonical in repository documentation or agent instructions and is straightforward to reconstruct; the project map links that source instead of injecting a duplicate atomic page. New status: superseded."
