---
id: "a-confirmation-gate-expressed-as-a-tool-argument-is-not-a-gate"
kind: "finding"
title: "A confirmation gate expressed as a tool argument is not a gate"
status: "proposed"
tags: ["mcp","agent-tools","permissions","security","integrations"]
created_at: "2026-08-21T04:47:23.879Z"
updated_at: "2026-08-21T04:47:23.879Z"
---
# A confirmation gate expressed as a tool argument is not a gate

<!-- compiled_truth -->

Operator tooling commonly guards a risky action with a flag: the command refuses to proceed unless a human either confirms at a terminal or passes an explicit opt-in argument, and refuses outright when running non-interactively with neither.

For a command a person types, that works. The argument is an assertion the person makes, and typing it is the deliberate act.

Ported to an MCP tool the guard inverts into decoration, because the opt-in argument becomes a parameter the model can simply set. A model that wants the action to succeed will pass it, and the failure mode is silent: the tool call looks identical to a properly authorized one, and the log records a confirmation that no human ever gave.

The rule this implies: **a confirmation gate must live in Otto's permission system, where a human actually sees it, and it must not be expressible as a tool argument.** If a tool has a parameter whose only function is to assert that a human approved something, that parameter is a bug.

This matters now because the integration surfaces under consideration (issue trackers, wikis, code hosts) carry exactly the operations these guards were written for: uploading files to a third party, deleting or archiving content, and posting to a shared workspace where the write is visible to other people and is not always reversible.

A related pattern from the same tooling is worth carrying and is not affected by this problem, because it does not depend on an assertion: tiering destructive operations so the reversible form is the default, the recoverable-but-not-automatic form is opt-in and confirmed, and the irreversible form is not offered through the API at all.

## Timeline

- time: "2026-08-21T04:47:23.879Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["daemon-owned-tracker-and-pull-request-capabilities-are-not-exposed-to-agents","connectors"]
- time: "2026-08-21T04:47:23.879Z"
  kind: "evidence"
  summary: "Observed 2026-08-20 while auditing a 41-script operator corpus for Jira, Confluence, and Bitbucket Cloud.\n\nTwo instances in the corpus. A file-upload script blocks until the operator either answers an interactive prompt at a terminal or passes an explicit opt-in flag, and refuses when neither a terminal nor the flag is present. A page-deletion script makes the reversible archive path the default, requires interactive confirmation for the recoverable trash path while refusing non-interactive invocation, and offers no permanent-purge path at all, on the stated reasoning that irreversible destruction should require the vendor's own interface.\n\nThe inversion under MCP is a design inference, not a measured failure: no such tool exists in Otto yet, and none was tested. Recorded before the surface is built rather than after, because the guard reads as correct when the script is ported literally and the defect is invisible in review.\n\nOtto's permission system is the existing mechanism this points at; no new mechanism is proposed here."
