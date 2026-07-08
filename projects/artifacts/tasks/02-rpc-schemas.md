# Task: Define Artifact WebSocket RPC Schemas

## Goal

Create the WebSocket RPC message schemas for artifact operations in `packages/protocol/src/artifacts/rpc-schemas.ts`.

## Context

Otto uses WebSocket RPCs with dotted names. Follow `docs/rpc-namespacing.md` for naming conventions. The namespace format is `artifact.client.<operation>.request/response` for client-to-daemon and `artifact.daemon.<event>.notification` for daemon-to-client push events.

## References

- `docs/rpc-namespacing.md` — RPC naming conventions (dots, not slashes; verb operations; request/response pairs)
- `packages/protocol/src/messages.ts` — existing message schemas and patterns
- `docs/artifacts.md` — section "WebSocket RPCs" lists all required RPCs
- `tasks/01-protocol-types.md` — depends on `ArtifactMetadata` and `CreateArtifactInput` types

## What to Create

**File:** `packages/protocol/src/artifacts/rpc-schemas.ts`

Define Zod schemas for these RPC messages:

### Client → Daemon (Requests)

| RPC Name                              | Input Fields                                                  |
| ------------------------------------- | ------------------------------------------------------------- |
| `artifact.client.list.request`        | `projectId?: string` (optional filter), `requestId: string`   |
| `artifact.client.create.request`      | `CreateArtifactInput` fields + `requestId: string`            |
| `artifact.client.delete.request`      | `artifactId: string`, `requestId: string`                     |
| `artifact.client.star.request`        | `artifactId: string`, `starred: boolean`, `requestId: string` |
| `artifact.client.get-content.request` | `artifactId: string`, `requestId: string`                     |

### Daemon → Client (Responses)

| RPC Name                               | Payload                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `artifact.client.list.response`        | `artifacts: ArtifactMetadata[]`, `success: boolean`, `error?: string`, `requestId: string` |
| `artifact.client.create.response`      | `artifact: ArtifactMetadata`, `success: boolean`, `error?: string`, `requestId: string`    |
| `artifact.client.delete.response`      | `success: boolean`, `error?: string`, `requestId: string`                                  |
| `artifact.client.star.response`        | `artifact: ArtifactMetadata`, `success: boolean`, `error?: string`, `requestId: string`    |
| `artifact.client.get-content.response` | `content: string`, `success: boolean`, `error?: string`, `requestId: string`               |

### Daemon → Client (Push Notifications)

| RPC Name                               | Payload                      |
| -------------------------------------- | ---------------------------- |
| `artifact.daemon.updated.notification` | `artifact: ArtifactMetadata` |
| `artifact.daemon.created.notification` | `artifact: ArtifactMetadata` |
| `artifact.daemon.deleted.notification` | `artifactId: string`         |

## Acceptance Criteria

- File exists at `packages/protocol/src/artifacts/rpc-schemas.ts`
- Each RPC has a Zod schema for its message shape
- Request schemas include `requestId: string` as correlation key
- Response schemas include `success: boolean`, optional `error?: string`, and `requestId: string`
- RPC type strings match the naming convention: `artifact.client.<verb>.request` etc.
- Import types from `@otto-code/protocol/artifacts/types` (the module created in task 01)
- No `any`, no `as` casts
