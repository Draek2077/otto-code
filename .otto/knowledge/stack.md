---
slug: "stack"
title: "Stack"
role: "technology choices"
updated: "2026-08-08T05:16:40.879Z"
---

# Stack

## Chosen technologies

| Domain                   | Choice                                                      | Rationale / ownership                                                                 |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Repository               | npm workspaces + TypeScript                                 | Shared types with explicit package boundaries and generated declarations              |
| Daemon                   | Node.js                                                     | Long-lived local orchestration, process control, filesystem and network services      |
| Wire contract            | Zod schemas + generated validators                          | One backward-compatible structural source for every client and daemon                 |
| App                      | React Native + Expo + Expo Router                           | One client surface across iOS, Android, web, and Electron's renderer                  |
| Desktop                  | Electron                                                    | Bundled cross-platform shell that can manage the local daemon and native integrations |
| CLI                      | Commander over the shared daemon client                     | Scriptable access without a parallel backend                                          |
| Remote access            | WebSocket + optional E2E relay                              | Direct local operation first; encrypted reachability when the daemon is remote        |
| Unit / integration tests | Vitest                                                      | Targeted tests around explicit ports and adapters                                     |
| App E2E                  | Playwright Chromium; Electron harness where engine-specific | Deterministic browser proof plus focused desktop coverage                             |
| Architecture docs        | Markdown, AsciiDoc, Mermaid                                 | Reviewable source with diagrams kept in Git                                           |
| Project knowledge        | Rich Markdown under `.otto/knowledge`                       | Portable, diffable memory with daemon-owned invariants                                |

## Development invariants

- Use the repo scripts for builds, formatting, linting, and generated declarations.
- Build owning workspace packages before diagnosing cross-package type errors.
- Use isolated daemon lanes: installed `6868`, dev `6788`, agent `6799`, tests/demos on dynamic ports.
- Run targeted test files locally; use CI for broad suites.

Sources: [development](../../docs/development.md), [testing](../../docs/testing.md), [architecture](../../docs/architecture.md), root [package.json](../../package.json), and [[project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto]].
