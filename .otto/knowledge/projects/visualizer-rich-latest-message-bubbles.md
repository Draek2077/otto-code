---
id: "visualizer-rich-latest-message-bubbles"
kind: "project"
title: "Visualizer rich latest-message bubbles"
status: "proposed"
tags: ["visualizer","chat","rich-content","semantic-zoom","performance"]
delivery_status: "charter"
progress_completed: 0
progress_total: 5
progress_unit: "delivery stages"
created_at: "2026-09-06T15:14:10.137Z"
updated_at: "2026-09-06T15:14:10.137Z"
---
# Visualizer rich latest-message bubbles

<!-- compiled_truth -->

# Rich latest-message bubbles with semantic zoom

## Outcome

The Visualizer becomes a conversation-aware graph without becoming a duplicated chat transcript.

Every visible agent node retains exactly one current message: its latest non-empty assistant-visible response. It stays on the node until that agent produces a newer assistant response. User prompts, thinking events, and tool activity do not clear it. A node that has not produced an assistant-visible response shows no message bubble rather than inventing a summary.

Only the root node of the **currently focused chat** can render its retained message as rich response content. All child, observed-subagent, and non-focused independent-root nodes render a compact plain-text message bubble. This applies in every Visualizer surface, subject to that surface's chrome policy. In the All active aggregate, other independent chat roots are compact; only the focused chat's root may be rich. This is the necessary density boundary.

## Product behavior

### Message ownership

- The Visualizer derives messages from its existing native conversation record, not from `AssistantMessage`, the chat DOM, or a second host-side transcript.
- A node owns only its latest assistant-visible response. A new assistant response atomically replaces the prior bubble.
- Every node's compact bubble uses the existing canvas bubble language: role label, plain wrapped text, one current message, and native hit testing/camera participation.
- Conversation history remains owned by chat. The Visualizer never becomes an alternate multi-message transcript.

### Rich root response

- The focused root's native bubble promotes from compact text to a structured response renderer.
- The first supported blocks are prose, headings/lists, emphasis/inline code, and fenced code blocks rendered in monospace.
- Images, LaTex, tables, and widgets are explicit later block types. They are not coerced into plain text or rendered through the app chat component.
- A large rich response receives a viewport-relative line/height budget in its compact node state. If content exceeds that budget, the visualizer exposes a native expand action rather than making the graph unbounded.
- Expansion replaces the root's compact bubble with one Visualizer-native response reader. It does not mount a chat transcript, hide the Composer, or expand every node.
- Screenshots render as cached thumbnails in compact form and full safe assets only in the focused reader.
- LaTex is rasterized or laid out once and cached; it is never typeset during each animation frame.
- Widgets are initially snapshots plus a semantic state summary. Interactive controls require a purpose-built Visualizer adapter and must not embed arbitrary React/widget trees in the canvas.

### Semantic zoom and navigation

| Distance | Focused root | Every other node |
| --- | --- | --- |
| Overview | Reply indicator and concise summary | Reply indicator and concise summary |
| Working distance | Rich compact blocks within the viewport budget | Plain text compact preview |
| Close / selected | Rich compact blocks; native expand action when needed | Plain text bubble with native hit target |
| Expanded reader | One focused-root Visualizer-native rich reader | Remain compact in the graph |

- The graph layout and auto-fit bounds account for nodes and bounded compact bubbles only. A rich reader never pushes the global graph layout apart.
- At most one rich response reader is expanded at once.
- Far-away/offscreen nodes do not parse Markdown, syntax-highlight code, decode images, typeset formulas, or initialize widgets.
- Derived previews, syntax layouts, formula rasterizations, and image thumbnails are cached by immutable message content identity and invalidated only when the message changes.
- Node bubbles continue to participate in hit testing and camera framing. The camera must include the entire bounded compact bubble, never clip it at an edge, and never zoom the graph solely to accommodate an expanded reader.

## Architecture and boundaries

- Extend the vendor `MessageBubble` model into a structured, versioned response-block representation owned by the Visualizer simulation. Preserve the existing plain-text path for compact non-root bubbles.
- Keep the app-to-guest bridge capability-scoped: the host supplies structured content only when the guest advertises rich-response support. The background feature has no degraded reimplementation for older guests.
- Asset references crossing into the guest are safe, scoped identifiers resolved by the host. Raw local paths, arbitrary HTML, and untrusted remote URLs are not rendered directly.
- Rich response rendering is part of the Visualizer's native rendering/interaction pipeline. It must not import chat message components or their providers.
- Existing PIP/tab/background chrome policies continue to govern whether an expanded reader can be opened. Chat background keeps the Composer available and preserves the user's hidden-conversation state across sends.

## Delivery sequence

1. **Message model and compact all-node behavior**
   - Formalize latest assistant-visible response selection per agent.
   - Enable one persistent compact bubble on every node.
   - Keep the current focused-root bubble rich-capable but plain until structured blocks land.
   - Add simulation and camera tests for replacement, persistence, all-node density, and clipping.

2. **Structured root response blocks**
   - Add a provider-neutral block schema and bridge capability.
   - Implement prose, inline formatting, lists, and monospace fenced code in the native renderer.
   - Add semantic zoom and bounded measurement tests.

3. **Native expanded reader**
   - Add a single-root expand/collapse interaction, viewport ownership, keyboard escape behavior, and cache lifecycle.
   - Verify background Composer usability, camera invariants, tab/PIP behavior, and accessibility labels.

4. **Media and formulas**
   - Add safe screenshot thumbnail/full-asset handling and cached formula rendering.
   - Establish image memory budgets, cache eviction, and no-frame-loop decode/type-setting proofs.

5. **Tables and supported widgets**
   - Add table layout only after measured behavior on constrained canvases.
   - Specify each interactive widget adapter individually; unsupported widgets remain a static summary/snapshot with an explicit open action.

## Acceptance criteria

- A graph with many nodes retains one current compact response per node without overlapping or unbounded layout growth.
- Only the focused chat's root renders rich blocks; every other node remains a compact native bubble, including independent roots in All active.
- A new assistant response replaces exactly that node's prior response; later user/tool events do not clear it.
- Semantic zoom preserves legibility and navigation at overview, working, and close distances.
- Expanded rich content is single-instance, Visualizer-native, bounded, and does not disturb graph auto-fit.
- Code is monospace; media/formulas/widgets follow their explicit safe rendering policies.
- No rich content is eagerly parsed or decoded for offscreen/far-away nodes.
- The implementation remains provider-neutral and does not reuse the chat message component tree.
- Targeted simulation/render tests, Visualizer build, app typecheck, targeted lint, and focused browser/Electron coverage pass before delivery.

## Out of scope

- Reconstructing the full chat transcript in the Visualizer.
- Arbitrary HTML, arbitrary React components, or arbitrary remote content inside a canvas bubble.
- Multiple simultaneously expanded rich readers.
- Cross-host aggregation changes.
- Interactive widgets without an individually designed adapter and safety review.

## Timeline

- time: "2026-09-06T15:14:10.137Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["visualizer-pip","chat-visualizer-background-is-fixed-to-the-visible-viewport"]
- time: "2026-09-06T15:14:10.137Z"
  kind: "evidence"
  summary: "User direction, 2026-09-06: every node should show its message, but rich content is reserved for the root node. Follow-up discussion established semantic zoom, a single expanded reader, bounded camera/layout participation, and on-demand rich rendering as the scalability constraints."
