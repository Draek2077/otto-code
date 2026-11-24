---
id: "otto-0-10-context-management-restoration"
kind: "project"
title: "Otto 0.10 Context Management restoration"
status: "proposed"
tags: ["otto-0.10","context-management","paseo-port"]
delivery_status: "in_build"
progress_completed: 4
progress_total: 6
progress_unit: "checkpoints"
created_at: "2026-10-26T01:40:52.416Z"
updated_at: "2026-11-05T14:22:45.885Z"
---
# Otto 0.10 Context Management restoration

<!-- compiled_truth -->

# Context Management on Otto 0.10

Restore F05 from the working Otto 0.9 behavior onto Paseo 0.12, with Otto-owned files and small tagged seams. The user explicitly authorized this feature on 2026-10-25 after reviewing the restoration order. This is a separate initiative from Knowledge storage and does not restore deferred personalities, teams, general editor features, chat delivery or model-specific harnesses.

## Required product behavior

- Reachable workspace-bound Context Management, using existing Paseo panel/navigation, controls, page gutters and compact layouts while retaining the original source graph, fixed-weight summary, source inspection and prompt-preview intent.
- Distinguish hard instruction imports from soft references and conditional directory rules. A soft target is available to read, not injected weight. De-duplicate loaded sources and disclose missing, cyclic, bounded or unavailable inputs.
- Keep the six original context categories visible: context files, memory index, skills roster, tool schemas, Otto injections and system text. Exact text, convention-derived data and unavailable provider internals are distinct. Token estimates must never masquerade as tokenizer-exact or billing totals. Budget percentages use an explicit evaluation window; unknown inputs/history are not silently subtracted as zero.
- Use the same instruction resolver and request composition as the OpenAI-compatible/Brain harness. Inspect the last prepared request through the existing plugin RPC boundary without launching a provider/model or persisting prompt copies. A prospective scan is labeled not sent; a prepared snapshot does not prove provider delivery. CLI/provider-native internals remain unavailable unless a verified provider contract supplies them, with no fake controls.
- Let users inspect sources/categories and change supported import/link load modes only on the owning workspace, with whole-source revision validation and explicit confirmation. Preserve unrelated text/line endings, refuse stale/foreign/missing targets and uncertain retries. Existing chats may retain earlier provider context; do not rewrite historical conversation or promise native-provider reload.
- Pull full previews only on demand. Coalesce active read queries in the existing app query layer, suspend hidden/inactive reads, and refresh source/report state after local or external changes. Never create a parallel chat store or browser socket.
- Context proposals require read-only generation with isolation from user-configured startup automations. A normal provider coding session is not proof of this capability. Where isolation is unverified, this action stays unavailable with a clear explanation; ordinary chats and their own compaction remain unchanged.
- Preserve existing Otto homes, settings, instructions and Knowledge stores. No installed-data writes, migrations, restart, model launch or release as a side effect of registration/inspection. Discuss any additional provider-neutral selection/injection seam before extending core ownership.

## Acceptance checkpoints

1. Authoritative instruction graph/parser and bounded source inspection; compare frozen behavior and exercise imports, links, fences, aliases, deduplication, budgets and provider opacity.
2. Provider prepared-request inspection and shared runtime/report composition, including Brain and named/legacy aliases; no duplicate input or instruction weakening, credentials/history remain private.
3. Canonical host/workspace/agent binding and revision-pinned load-mode edits, including conflicts, lock cleanup, external changes and remote ownership.
4. Reachable Desktop/compact UI, navigation/context menu, category/source preview, budget evaluation, actionable errors and hide/late-response safety.
5. Provider-neutral ownership/visibility and source-selection limitations reviewed against the full historical contract; explicitly identify anything still missing rather than closing the feature on a partial inspector.
6. Exact-source focused checks, normal hooks, CI/builds and rendered wide/compact journeys, with real native/provider/device proof separately stated. Full F05 is incomplete until all accepted capabilities and proof gates are satisfied.

## Full-restoration audit and current boundary

The graph/request inspector has been extended with provider-convention inventories, bounded source/reference discovery, deterministic findings and reviewed mechanical fixes, source editing with revision checks, reviewed multi-file prose compaction, starter generation, and persisted desktop reading splitters. Wide panes scroll independently; compact navigation retains local drafts and confirmation authority. These are integrated application paths, not source-only handoffs. Provider-native hidden state remains labeled opaque where no verified inspection contract exists.

OpenAI Compatible API, Brain and configured aliases use their provider-owned text-only generation operation. Claude, Codex, Copilot, OpenCode, Pi and OMP have read-only utility policies with bounded lifecycle/output and injected-adapter evidence. Read-only tool restrictions alone do not prove startup isolation. Following Philippe's explicit isolation choice, the isolated session route admits Claude, Pi and OMP, plus Copilot's separate provider-owned utility operation. Codex and OpenCode's ordinary-session routes are gated until dedicated startup isolation is established; Muse and Antigravity also lack registered isolated utility adapters. Selected providers never silently fall through to writable chats or a different provider. Full isolated native-provider coverage remains unfinished.

The browser and Preview portions of the active combined goal are integrated: daemon-owned Host Browser pages/streaming/input, preserved native desktop browser tabs and host affinity, workspace-bound Preview ownership/reuse/recovery, and one Preview play gutter menu with Manage Preview servers last. No second management gutter icon is required.

### Verified delivery evidence

- Full CI run 40447182539 passed all 21 jobs at 2a4c2519a754425af225a9d9401993510c85759b, including the repaired native desktop browser regression.
- Otto App Acceptance run 40446303135 and Windows/Linux Host Browser Acceptance run 40446303204 passed at cc39dd9e7592a3bcb7ad67f72e254daf51946a12. The real wide/compact journeys exercise Context and Preview against an isolated daemon and deterministic local inference fixture.
- Docker build-only run 40446305613 passed, including a real packaged Chromium screenshot smoke as the image's unprivileged user. Nix run 40447185209 passed Linux and Darwin builds plus packaged Host Browser/daemon smoke after the glibc tracer correction. The tracer filters only unreachable extract-zip musl native variants on a proven glibc host; it does not ignore arbitrary missing libraries.
- Unsigned desktop build-only run 40443576762 and Android APK/AAB build-only run 40443580214 passed at 361324d65c7e543043db181bae772b644a3db1ff. Android app/client/protocol/plugin/lockfile inputs have not changed since that build. These are retained build results, not newly published releases.
- Subsequent changes through 9b0e8b03101d4a8f3ef4d262657b0f4e1f1454e3 are credential-free native contract tooling/documentation. Normal formatting/lint and workspace typecheck hooks passed. Native contract run 40449628177 passed real echo/discovery assertions in disposable CI homes, without model requests. Its artifacts distinguish rejected MCP overrides from successful isolated hook suppression and do not prove a completed Muse/Antigravity adapter.

### Remaining gates (reconciled 2026-11-05)

Current verification source is 1b4c76aa615e20e91f09985c8f0ac7343178c41c on otto-0.10/phase-0. Full CI 41958046132 passed every job; Otto App Acceptance 41956398828 passed all 71 journeys. Windows/Linux, unsigned Intel/Apple Silicon Mac, Android APK+AAB, Nix and Docker builds passed at c0130fdbe5c75271e98f3556af4084a5cea96c0c; final successors change only tests/docs, with identical production/packaging inputs. These are CI/fixture and packaging results, not live vendor permissions, real model/GPU or physical-device acceptance. No installed Otto change or release occurred.

Checkpoints 1–4 remain integrated and verified. Graph/parser, prospective/prepared-request inspection, host/workspace editing, starter files and reviewed compaction are present. Unsupported isolated native utility paths remain visibly unavailable; ordinary chats are unchanged. The older full CI run 40499249188 is historical rather than a current pending gate.

Philippe explicitly parked the broader read-only Context generation/startup-isolation investigation in a separate chat. Checkpoint 5 remains open for missing verified native utility adapters/isolation coverage, and checkpoint 6 retains full provider/platform/product acceptance. Current green CI cannot supply missing provider contracts or live native-model/device proof. Do not resume the parked research, change normal provider compaction or silently allow ordinary writable/startup-customized sessions during checklist review. Existing iOS signing gate and installed-home isolation remain.

Independent Windows Metro mitigation 78c5c83c927a33280c34d27e63c6faac75719197 passed full CI and existing app acceptance. The user reports one restart did not crash; the original EMFILE remains unreproduced. A separate Windows forge-argv defect and raw PR error presentation were corrected at 2231696eb76ab2628815d7692e6ee2b9ba9b8ed9, with a real-child multiline argv fixture and four error-mapping cases, normal hooks and a read-only real GraphQL probe. This does not repair repository permissions or change global credentials. Otto repository operations use Draek2077; Amid Reality uses PhilTasty.

Historical requirements remain in [[project-knowledge-context-management]] and the master scope remains [[otto-0-10-clean-paseo-rebuild]].

## Timeline

- time: "2026-10-26T01:40:52.416Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-10-26T01:40:52.416Z"
  kind: "evidence"
  summary: "Philippe's explicit F05 implementation authorization and Otto/Paseo integration/UI requirements in this conversation, 2026-10-25; frozen source otto-0.9-final 95a19522a191394a874320041eaf05f6c5f3c682 and docs/context-management.md; new source is unverified."
- time: "2026-10-26T03:09:08.708Z"
  kind: "decision"
  summary: "User explicitly expanded the goal to full Context Management and full Preview restoration; reconcile the verified inspector/CI/visual evidence and expose remaining historical Context behavior before further implementation."
  source: "User goal update; integration commits 78c5c83c, 856777da4, 2231696eb, f076d97d4, d462d3787, 39f384294; focused logs and CI artifacts."
- time: "2026-10-27T04:28:50.835Z"
  kind: "decision"
  summary: "Reconcile the implemented Context/Browser/Preview paths and verified CI/build results after the user's requested wrap-up. Preserve the full scope and explicitly retain the two missing native utility adapters and remaining acceptance gates."
  source: "Implementation commits through 9b0e8b031; GitHub Actions runs cited in the verified delivery evidence; user instructions in this conversation."
- time: "2026-10-27T04:28:52.712Z"
  kind: "note"
  summary: "Graph/parser, prepared-request inspection, revision-pinned host/workspace actions and reachable wide/compact UI are integrated with passing source checks and real app acceptance. Full CI 40447182539 passed 21/21 jobs; Nix, Docker, desktop and Android build results are recorded with exact source boundaries. Native Muse/Antigravity utility coverage and final post-integration acceptance remain open; full F05 is not complete."
  affects: ["otto-0-10-context-management-restoration"]
- time: "2026-10-27T11:52:19.852Z"
  kind: "decision"
  summary: "Philippe explicitly selected read-only Context generation with isolation. Record the verified conservative gate and user-visible recovery behavior, distinguish model tool restrictions from startup isolation, and retain unfinished native adapter coverage and pending CI."
  source: "User's 2026-10-27 isolation choice; commit 00fd5d2a911577e0a504b864e1f7de78a21204ae; six new focused cases; normal hooks and typechecks; CI run 40499249188."
- time: "2026-11-05T14:22:45.885Z"
  kind: "decision"
  summary: "Philippe requested accurate checklist reconciliation and review. Replace stale child-only/pending/failed-run claims with current integrated behavior and final green CI, preserving unproved native/provider/vendor/product acceptance gates and parked research. No feature or review confirmation is granted."
  source: "https://github.com/Draek2077/otto-code/actions/runs/41958046132"
  affects: ["otto-0-10","restoration-checklist","review"]
