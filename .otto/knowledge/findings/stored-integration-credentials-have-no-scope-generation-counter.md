---
id: "stored-integration-credentials-have-no-scope-generation-counter"
kind: "finding"
title: "Stored integration credentials have no scope generation counter"
status: "proposed"
tags: ["integrations","oauth","connectors","security","credentials"]
created_at: "2026-08-21T04:47:42.389Z"
updated_at: "2026-08-21T04:47:42.389Z"
---
# Stored integration credentials have no scope generation counter

<!-- compiled_truth -->

Otto's integration authorization platform already treats a scope change as a deliberate release operation: the vendor portal inventory, the scopes Otto requests, and the scope each called operation requires are three adjacent declarations, and a test asserts every active operation is both portal-approved and requested. Vendor portals expose no safe runtime introspection, so changing scopes means updating the portal, updating the code, and requiring the user to authorize again.

What is missing is the mechanism that makes the last step happen. A credential stored before a scope was added remains stored and remains apparently valid. Nothing marks it as insufficient. The user discovers the problem when a new capability fails against the vendor with a permission error, which surfaces as a broken feature rather than as an instruction to re-authorize.

Audited operator tooling solves this with a **scope generation counter**: a single integer stored alongside the credential, bumped whenever a release adds a required scope, with each caller declaring the minimum generation it needs. A credential below the minimum fails locally with "re-authorize", naming the setup action, before any vendor request is made.

The idea is cheap, orthogonal to how the credential is obtained, and applies to every credential method the platform holds rather than only to OAuth. It is the one mechanism worth carrying from a file-based credential system that is otherwise rejected wholesale under Otto's daemon-owned authorization model.

Not yet decided: whether the counter is global to the platform or per integration, and whether a below-minimum credential should block the capability or degrade it. Per integration seems right on first reading, because scopes move independently per vendor, but this has not been worked through.

## Timeline

- time: "2026-08-21T04:47:42.389Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["integration-authorization-is-daemon-owned-and-reusable","connectors"]
- time: "2026-08-21T04:47:42.389Z"
  kind: "evidence"
  summary: "Observed 2026-08-20 while auditing a 41-script operator corpus for Jira, Confluence, and Bitbucket Cloud.\n\nThe corpus carries a version integer in its credential store alongside a changelog of what each generation added, and a shared loader that takes a minimum-version argument per call site and exits with a message naming the setup command when the stored credential is below it. The recorded reason for the one generation bump present was the addition of a write scope needed for pull-request creation.\n\nOtto side, checked against the working tree at commit 2d0b9a764: `docs/connectors.md` documents the three-way scope contract and states that a scope change requires the user to authorize again. The confirmed architecture page `integration-authorization-is-daemon-owned-and-reusable` records the same conclusion, reached independently from a real code-to-grant mismatch where Otto called operations whose scopes it had never requested.\n\nNo generation or version field was found on the stored credential in either the connector `auth` block or the credential vault. The absence is stated from reading the documented contract and the architecture record rather than from an exhaustive grep of the persistence layer, so it should be confirmed before being acted on."
