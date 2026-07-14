# TODO: Promote (reveal) an unattended run on a guardrail denial + emit a denial timeline entry

**From:** safe-unattended, Phase 3 finish (Phases 0–3 shipped and committed under `e9dc9c34b`; this
closes a `TODO(...)` already sitting in the code). See the
[safe-unattended charter](../safe-unattended/safe-unattended.md). **Size:** small, daemon-only.

## Context

An unattended run (schedule, artifact-generator, background) that hits a permission it can't
auto-approve is **denied by the daemon deny-responder** and, for suppression, runs hidden and does not
broadcast attention. That's correct for the happy path — but when a denial actually blocks progress,
the user currently gets no signal, and the run isn't surfaced.

Two gaps, both verified:

1. **Guardrail-denial does not promote the run.** Hard _errors_ already promote/reveal a hidden
   schedule run (the promote-on-error reveal in
   `packages/server/src/server/schedule/service.ts` ~L986–1120), but a guardrail **denial** does not
   trigger the same reveal. The missing hook is marked in code:
   - `packages/server/src/server/agent/agent-manager.ts` — `autoDenyUnattendedPermissionRequest`
     (~L4056–4116) auto-denies and calls `recordGuardrailDenial` (~L4105, bumping
     `guardrailDenials` / `lastGuardrailDenialAt`), with an explicit **`TODO(safe-unattended Phase 3)`
     at ~L4108** where the promote trigger belongs.
2. **No timeline entry for the denial.** The deny path logs + counts but emits no timeline item, so
   even once revealed there's nothing in the transcript explaining _what_ was denied.

## Task

1. In `autoDenyUnattendedPermissionRequest` (at the `TODO(safe-unattended Phase 3)`), fire a
   promote/reveal for the owning run — reuse the same mechanism the hard-error path uses so a denied
   unattended run stops being hidden and requests attention. Route through the owning service
   (schedule/artifact) rather than duplicating reveal logic; the schedule reveal already exists at
   `schedule/service.ts` ~L986–1120 — extend it (or its caller) to accept a "denied" trigger, not
   only "errored".
2. Emit a **timeline entry** for the denial (tool name + reason) so the revealed run's transcript
   explains the block. Emit it on the same denial path; keep it a normal timeline item so existing
   rendering picks it up.
3. Keep the happy path unchanged: a run that never hits a blocking denial stays hidden and silent.

## Verify

Run an unattended schedule that triggers a not-pre-approved permission → the run reveals itself
(leaves the hidden state, requests attention) and its transcript shows a denial entry naming the tool

- reason. A schedule with no blocking denial stays hidden. (`guardrailDenials` /
  `lastGuardrailDenialAt` counters already increment — confirm they still do.)

## Scope note

Provider mapping of the deny-responder to Codex/Copilot/OpenCode/Pi (it covers Claude + openai-compat
today) and the "should schedule agents be listed/persisted instead of internal/ephemeral" review are
**larger** follow-ups — they stay in the safe-unattended charter, not this quick task.

## Compat

Daemon-internal behavior over data already on the wire; the timeline entry is a normal timeline item.
Rebuild the daemon (`npm run build:server` + restart) to serve.
