---
id: "otto-0-10-bitbucket-restoration"
kind: "project"
title: "Otto 0.10 Bitbucket Cloud forge restoration"
status: "proposed"
tags: ["otto-0.10","bitbucket","forge","restoration","f19"]
delivery_status: "partial"
progress_completed: 5
progress_total: 6
progress_unit: "acceptance gates"
created_at: "2026-10-30T15:43:19.670Z"
updated_at: "2026-10-30T21:06:00.880Z"
---
# Otto 0.10 Bitbucket Cloud forge restoration

<!-- compiled_truth -->

# Outcome

Restore Bitbucket Cloud as a fully integrated Otto 0.10 forge on the clean Paseo 0.12 base, matching the implemented Otto 0.9 baseline that Philippe needs for work. A registered adapter or settings screen alone is not completion. Keep the shared upstream forge architecture, Otto-owned implementation files, marked small seams, existing data and installed Otto isolation.

## Scope

- Named host API connections and canonical project overrides; explicit host default/inheritance, add/edit/remove, coherent explicit saves, write-only API tokens and actionable conflict/unknown-outcome recovery.
- Read existing Otto 0.9 forge-connections.json and its versioned OS-vault identity without automatic migration or changing the preserved file. Preserve unknown metadata. A missing selected account never switches silently to a shared or ambient identity.
- Reuse shared daemon-owned Atlassian authorization and OS credential storage. Git retains its own SSH keys and credential helper; no global account switch, copied token into a clone URL or arbitrary API origin.
- Native official Bitbucket Cloud REST: PR list/search/detail/status, branch/head identity, fork checkout, build statuses, approvals, requested changes and comment/review timeline; explicit create, merge/squash and discussion Resolve/Reopen.
- Workspace discovery through the current user-workspaces API, repository list/search/create with explicit privacy, SSH/HTTPS clone through the existing destination flow. Handle late host capabilities without losing the requested remote or overriding the user's Back navigation.
- Canonical host settings link and Project Settings reachability, common Paseo controls and padding, wide/compact support, provider-neutral existing forge dispatch and PR attachments/source links.
- Bound response sizes, pagination, account-specific caches and demand-owned sequential polling. Invalidate old account authority and release observers on hide/final unsubscribe/shutdown.

Bitbucket Data Center/Server, native issue search, check log downloads, auto-merge and merge queues were outside the implemented frozen Cloud baseline and are not falsely advertised here. Historical PR review-write and no-checkout-diff gaps remain separate features.

## Acceptance gates

1. Exact frozen feature/source inventory and current vendor contracts, including API-token scopes and changed workspace discovery routes.
2. Inert registration, additive capability gate and typed host RPCs; schema/version compatibility and no upstream relay/Hub changes.
3. Isolated storage/API/controller fixtures prove routing, redaction, credential identity, read-only legacy handling, preservation, concurrent/stale saves, unknown writes, bounded requests/polls and explicit recovery.
4. Real app/daemon wide and compact journeys prove canonical navigation, form validation, retained drafts, peer conflicts and declined/accepted reload. Production UI wiring must be exercised in CI rather than inferred from pure tests.
5. Normal formatting, lint, typechecks, hooks and exact-source CI. Required product builds stay green with the existing iOS signing gate; no installed Release changes or local application/model launches.
6. Review employer-account access, native vault writes and Git authentication with Philippe during hands-on acceptance; synthetic fixtures are not proof of those external permissions. Record actual boundaries without pretending catalog/source readiness is full live acceptance.

After the active Bitbucket work and the full Connector/MCP restoration, obtain green CI for the final exact source and pause for Philippe's review before starting another feature.

## Current source checkpoint

Committed and pushed ae1e0b8b95f4362fa4611d35939c6336d738af12 on otto-0.10/phase-0. Implementation is under packages/server/src/services/otto/bitbucket and packages/app/src/otto/bitbucket, with structural plugin contracts and small marked registrations. docs/otto-bitbucket.md documents current behavior and boundaries.

Focused current evidence: connection store 11, poller 3, repositories 4, RPC 4, forge service 14; app connection form 5, repository form 8, clone handoff 3, forge URL/capabilities 3 and discussion controller 4. HTTP pagination fixture previously passed unchanged. Registry checks: server resolver 30, server registry 9, app registry completeness 5; actual managed-plugin compilation test 3. Exact targeted formatting/lint, isolated strict fixture typecheck, app/server typechecks, upstream seam/relay check and normal pre-commit workspace typechecks passed. The Windows registry-test URL conversion and module-level bridge React import were fixed after concrete precollection failures; the affected registry file then passed.

The new real-app Bitbucket settings journey is authored but has not run locally. Its stale save is designed to be refused before native-vault access and performs no vendor calls. Full CI 41083182709, automatic Otto App Acceptance and build-only Linux desktop 41083187362 were started for the pushed source; no green conclusion is claimed yet. Other platform exact-source builds, live account/Git/keyring acceptance and complete F19 remain open. Connector restoration has its own existing charter and is not delivered by this commit.

## Timeline

- time: "2026-10-30T15:43:19.670Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-10-30T15:43:19.670Z"
  kind: "evidence"
  summary: "Philippe requested full Bitbucket integration at least matching Otto 0.9 for employer use, green CI, full Connectors/MCP catalog parity, then a review pause. Source comparison uses otto-0.9-final 95a19522a191394a874320041eaf05f6c5f3c682; local proof and pushed source are recorded above. No vendor writes, local app/model launch, installed-home change or release publication occurred."
- time: "2026-10-30T16:51:54.483Z"
  kind: "evidence"
  summary: "The final Bitbucket source is committed/pushed as 1fcf71dc8d3e04b8ce5f7a7bc7dd43638a56cd31. Exact-source full CI passed all 21 jobs: https://github.com/Draek2077/otto-code/actions/runs/41089826880 . Exact-source Otto App Acceptance also passed: https://github.com/Draek2077/otto-code/actions/runs/41087319688 . This includes actual wide/compact Bitbucket Settings navigation, input validation, real shared-registry peer changes, stale-save refusal, retained drafts, and declined/accepted browser confirmation reload. The fixture now asserts an actual revision change rather than relying on an idempotent selection. SDK export-boundary coverage passed 70 cases after the Bitbucket export fix (the later Connector export work has separate evidence). Linux desktop build-only run https://github.com/Draek2077/otto-code/actions/runs/41083187362 passed on ae1e0b8b95f4362fa4611d35939c6336d738af12; later Bitbucket commits changed tests/docs only. That run includes packaged and installed Artifact sandbox/reload verification. No release published, version changed, installed Otto touched, local app/model launched, global GitHub identity changed, or employer/vendor account access claimed. Final all-platform builds and Philippe's native-vault/Git/employer-account acceptance remain distinct gates. Full Connector restoration remains active separately; pause for review only after that work and final exact-source green CI."
  source: "Bitbucket source 1fcf71dc8d3e04b8ce5f7a7bc7dd43638a56cd31; GitHub Actions, 2026-10-30"
- time: "2026-10-30T16:51:56.370Z"
  kind: "note"
  summary: "Source/vendor-contract inventory, architecture/registration, focused isolated fixtures and the real wide/compact app gate are verified. Exact Bitbucket CI and Linux packaged/installed build passed. Gate 5 still includes final all-product builds on the combined restoration source; gate 6 is Philippe's actual employer-account/native-vault/Git acceptance. This does not mark full F19 complete or advance the unrelated Connector charter."
  affects: ["otto-0-10-bitbucket-restoration"]
- time: "2026-10-30T21:05:59.197Z"
  kind: "evidence"
  summary: "The combined Bitbucket plus full frozen Connector/MCP restoration is committed/pushed at c3b5bfc3ec345b9f476c243ce7999c34c12a5012 on otto-0.10/phase-0. Exact final-source full CI passed all 21 jobs: https://github.com/Draek2077/otto-code/actions/runs/41125365446 . Real app acceptance passed on unchanged app production code: https://github.com/Draek2077/otto-code/actions/runs/41118047627 (6d43cfb8699f9bc15f4575cf364188b72745e135; later differences are desktop test-probe files and a generated Nix hash). Windows/Linux desktop, unsigned macOS x64/arm64 and installed Linux native/sandbox checks passed https://github.com/Draek2077/otto-code/actions/runs/41120159195 . Docker amd64/arm64 and non-root Host Browser passed https://github.com/Draek2077/otto-code/actions/runs/41123130273 . Linux/macOS Nix passed https://github.com/Draek2077/otto-code/actions/runs/41123135940 ; its evaluated hash is exactly the generated hash committed in final HEAD. Signed Android APK/AAB passed https://github.com/Draek2077/otto-code/actions/runs/41108599386 on unchanged Android client/protocol source. Existing iOS/signing gates remain. All were build-only; nothing was released, deployed or submitted. Normal formatting/lint and workspace typechecks/hooks passed. Existing account/vault identities, registrations and settings remain retained; no employer account, global GitHub identity, installed Otto or live credentials were changed. Gate 5 is now verified. Gate 6 remains Philippe's actual employer-account/native-vault/Git acceptance, which synthetic fixtures cannot establish. Stop at the requested review pause before another feature; this does not declare all historical F19 work or live account permissions complete."
  source: "Final combined restoration c3b5bfc3ec345b9f476c243ce7999c34c12a5012, verified 2026-10-30"
- time: "2026-10-30T21:06:00.880Z"
  kind: "note"
  summary: "The final combined source has green exact-commit full CI, real app acceptance on unchanged app code, Windows/Linux/unsigned macOS builds and native package checks, Android APK/AAB, Docker and Linux/macOS Nix. This closes gate 5; only the deliberately user-owned live employer-account/native-vault/Git acceptance gate remains. Preserve proposed review status and pause for Philippe's review; do not claim external access or full historical F19 completion."
  affects: ["otto-0-10-bitbucket-restoration"]
