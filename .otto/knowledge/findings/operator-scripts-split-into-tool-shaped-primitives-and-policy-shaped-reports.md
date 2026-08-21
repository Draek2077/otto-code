---
id: "operator-scripts-split-into-tool-shaped-primitives-and-policy-shaped-reports"
kind: "finding"
title: "Operator scripts split into tool-shaped primitives and policy-shaped reports"
status: "proposed"
tags: ["agent-tools","mcp","integrations","token-economy","design"]
created_at: "2026-08-21T04:48:46.750Z"
updated_at: "2026-08-21T04:48:46.750Z"
---
# Operator scripts split into tool-shaped primitives and policy-shaped reports

<!-- compiled_truth -->

When mining an existing body of operator tooling for an agent tool surface, the useful cut is not by service. It is by shape, and the two shapes want opposite treatment.

**Primitives** wrap one API concept: fetch an item, comment on it, change its state, create a page, open a pull request. They are thin, they compose, and they map to tools close to one for one. In the audited corpus these were roughly 55% of the files and a much smaller share of the code.

**Reports** aggregate many calls and embed organizational policy in the aggregation: what counts as healthy, which states are terminal, how to weight elapsed time, which teams and repositories exist, which board a team uses. In the audited corpus these were the remaining 45% of the files and the clear majority of the lines, with the three largest scripts all in this group.

Turning reports into tools is the trap. It produces a large, brittle tool surface that costs context on every turn, encodes one organization's definitions as if they were product features, and breaks on any tenant but the one it was written for. The same output is better reached by composing primitives, which in Otto means a skill or a playbook rather than a tool.

The reports are not worthless, but their durable content is thin: query construction, and reading an item's changelog to reconstruct state history over time. That knowledge belongs on the API reference page for the service. The definitions do not belong anywhere.

A useful signal for telling them apart: a primitive's parameters are all things the vendor's API names. A report's parameters include things only the organization names.

The same audit surfaced two related lessons. Tenant-specific identifiers (custom field ids, workflow transition ids, board ids) must be resolved by name at runtime rather than hardcoded, and a corpus will usually contain one script that already does this correctly among many that do not. And a round-trip document format shared across read, create, and update beats three operations with unrelated schemas, because the artifact the model read is the artifact it edits and returns.

## Timeline

- time: "2026-08-21T04:48:46.750Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["daemon-owned-tracker-and-pull-request-capabilities-are-not-exposed-to-agents","reference-jira-cloud-rest-api","reference-confluence-cloud-rest-api","connectors"]
- time: "2026-08-21T04:48:46.750Z"
  kind: "evidence"
  summary: "Audit performed 2026-08-20 of a 41-script operator corpus targeting Jira, Confluence, and Bitbucket Cloud, undertaken to learn what an agent-facing integration surface for those services would need.\n\nClassification: 23 primitives (16 tracker and wiki item operations, 6 pull-request operations, 1 batch creation) and 18 reports and infrastructure. The three largest files in the corpus, at roughly 51KB, 46KB, and 38KB, were all reports. The primitives were typically 3KB to 12KB.\n\nPolicy embedded in the reports, as concrete examples of what does not generalize: business-day weighting that counted some weekdays as half days, a fixed threshold for how much ready work constitutes a healthy backlog, title-substring matching to classify a merge as a failed change, and lookup tables mapping team names to board identifiers.\n\nExcluded from the audit by explicit user direction on 2026-08-20 and not recorded anywhere: object-storage tooling, build-server tooling, all CI/CD and QA reporting, all engineering-management analytics, third-party services outside the three above, and the corpus's file-based credential system, which is superseded by Otto's daemon-owned authorization platform. Organization names, site origins, tenant identifiers, and every hardcoded field, transition, and board identifier were deliberately excluded from all pages recorded in this session.\n\nThe classification is a judgment applied to one corpus, not a measured property. The percentages describe that corpus only."
