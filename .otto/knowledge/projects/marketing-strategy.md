---
id: "marketing-strategy"
kind: "project"
title: "Marketing Strategy"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "charter"
created_at: "2026-08-08T06:17:56.235Z"
updated_at: "2026-08-08T06:19:48.173Z"
---

# Marketing Strategy

<!-- compiled_truth -->

# Otto marketing strategy

Charter. Nothing here is built yet.

## Why this exists

Otto inherited Paseo's public voice along with its code. The README, the landing page, the
sponsor page, and the blog byline all spoke as Mo: his X handle, his Discord, his avatar,
his first-person "I'm a solo maintainer, ping me on Discord". That is a fork of someone
else's web identity, not a fork of their software, and it has been removed (see "Voice
cleanup" below).

Removing it left a real gap: **Otto currently has no public presence of its own.** Every
"reach us" path in the product and on the site now points at GitHub Issues. That's honest
and correct as a floor, but it's the only channel, and GitHub Issues is a bad first
impression for anyone who hasn't already decided to try the thing.

## The voice we replaced it with

Otto's public voice is **Philippe, first person, singular**. Not "we", not a company.

The story, in one paragraph. This is the canonical version; keep the site, README, and any
future post consistent with it:

> Otto is a personal project by Philippe, not a startup. Just the environment I want to
> work in and the way I'm getting better at agentic coding. Most of Otto is written by the
> agents Otto runs. The problem I keep hitting is that agents can now do an enormous amount
> of work on their own, and it's hard to see what they did, what it cost, and where it went
> sideways. So the work leans toward making that legible: real per-subagent token and cost
> accounting, a live visualizer of the orchestration graph, browser-verified previews so an
> agent proves a change instead of claiming it. The rest is pulling good open-source pieces
> into one setup that works end to end.

Tone rules:

- First person singular. Never "we", because there is no we.
- No startup posturing, no roadmap promises, no "trusted by" anything.
- Credit upstream loudly and specifically, and say _why_ the work is good rather than just
  naming it. Two projects carry Otto and both get named sections, not footnotes:
  - **Paseo (Mo Boudra, AGPL-3.0)**: the foundation. The compliment that is actually true:
    the hard parts were already right (process lifecycle, clean WebSocket protocol, real
    cross-platform clients, E2E relay), so Otto's work is features instead of plumbing.
  - **Agent Flow (Simon Patole, Apache-2.0)**: the Visualizer's render layer, vendored as a
    git subtree. The compliment that is actually true: Simon kept rendering separate from
    event collection behind a small documented bridge protocol, which is the only reason Otto
    could drive the same graph from its own provider-neutral stream and have it work for
    every provider. Adapting it has been the most enjoyable part of the project, so say so.
  - Trademark guardrail: never use "Agent Flow" as a UI label or ship their logos. The
    feature is **"Visualizer"**, locked (`vendor/agent-flow/TRADEMARK.md`). Attribution prose
    is fine and required; branding is not.
- Otto takes no sponsorships of its own; support routes upstream to both.
- Lead with the observability thesis, not the feature list. The feature list is the proof,
  not the pitch.

## Voice cleanup (done)

| Where                                          | Was                                            | Now                                              |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `README.md` badges                             | X @moboudra, Paseo Discord, r/OttoAI           | GitHub stars / release / issues                  |
| `README.md` note                               | "I'm a solo maintainer… reach me on Discord"   | One-person project, GitHub Issues                |
| `README.md`                                    | None                                           | New "Why I'm building this" section              |
| `landing-page.tsx` BuiltOnPaseoSection         | "one developer wanting to shape Paseo…"        | `BuiltOnOpenSourceSection`; Philippe's story     |
| `landing-page.tsx` upstream pillars            | 2 cards (Paseo / Otto)                         | 3 cards: Paseo, Agent Flow, Otto mission         |
| `landing-page.tsx` FAQ + credit CTA            | "we / ours"                                    | "I / mine"; new "What powers the Visualizer?"    |
| `sponsor.tsx`                                  | "Support Mo, the author of Paseo"              | "Support the projects Otto is built on" (both)   |
| `README.md` credits                            | one Paseo paragraph                            | named section per project, each with the why     |
| `NOTICE`                                       | generic third-party clause                     | explicit Agent Flow Apache-2.0 + §4 state notice |
| `blog/$.tsx` byline                            | Mo Boudra + his avatar, linking x.com/moboudra | Philippe → github.com/Draek2077                  |
| `site-header.tsx`, `site-footer.tsx`           | Discord icon, Discord + Reddit links           | Removed; Issues link                             |
| `community-links.tsx` (app)                    | "Community" → Paseo Discord                    | "Feedback" → Otto Issues                         |
| `packages/website/public/9viSwGkz_400x400.jpg` | Mo's avatar                                    | Deleted                                          |
| `.github/ISSUE_TEMPLATE/*.yml` (all 3)         | "reach me on Discord" → Paseo's Discord invite | GitHub Issues / Discussions                      |
| `packages/expo-two-way-audio/package.json`     | homepage+repository → `github.com/boudra` fork | Otto monorepo; bugs → Otto Issues                |
| `shorten-path.test.ts`, `session*.test.ts`     | `moboudra` fixture username/displayName        | neutral `devuser` fixtures                       |

The `author`/`bugs`-style attribution to genuine upstream authors was deliberately kept where
it names the real original author and not Mo: Speechmatics stays credited as the
`expo-two-way-audio` `author` (it's their MIT library, forked once by Mo, now vendored here);
only the Mo-fork URLs were repointed.

**Deliberately left as-is:** `.github/FUNDING.yml` still lists `github: [boudra]`. This is the
repo's GitHub Sponsor button, which is the repo-level equivalent of the support page and part
of the same intentional dedication. Revisit only if the sponsor dedication changes. (GitHub
`custom:` URLs could add Agent Flow here to parallel the sponsor page if desired.)

## Open work: channels Otto actually needs

None of these exist yet. Roughly in the order they'd pay off:

1. **GitHub Discussions**: turn it on for `Draek2077/otto-code`. Zero cost, right venue
   for "how do I…" that shouldn't be an issue, and it's already where the links point.
2. **A Discord of our own**: the one channel people genuinely expect from a self-hosted dev
   tool. Only worth creating once there's someone to talk to; an empty server reads worse
   than no server. Gate on: first handful of external users.
3. **An X / Bluesky / Mastodon account**: for release notes and short build-log posts. Pick
   one, not three. This is also the natural home for the "agents built this, here's what
   that looked like" content, which is the genuinely differentiated angle.
4. **The blog**: `packages/website/src/posts/` is wired up and completely empty. The blog
   route, byline, and index all work; there is simply nothing in it. Cheapest credible
   first move on this list.
5. **r/OttoAI or similar**: lowest priority. Subreddits need sustained volume; skip until
   there's a community that would fill one.

Every one of these needs a decision from Philippe (accounts, handles, moderation appetite)
before any code or copy lands. Nothing should be linked from the site or the app until the
destination actually exists. That's the mistake being corrected here.

## Content angles worth having

- **Build log, agent-authored.** Otto is written by the agents it runs. Post the real
  artifacts: the visualizer graph of a feature being built, the token/cost ledger for it,
  the preview verification that caught the bug. Nobody else can show this because nobody
  else instruments it.
- **"What did that actually cost?"** Per-subagent accounting is the least-solved problem in
  agentic coding and Otto has real numbers. One honest post with real figures beats ten
  feature announcements.
- **Provider parity.** "The same frontier tooling on a local LM Studio model as on Claude"
  is the fork's whole mission and is concretely demonstrable.

The proof behind all three is inventoried in
[feature-inventory.md](feature-inventory.md): 238 verified additions beyond Paseo as of 0.7.0.
It is source material, not copy: nothing in it is published yet, and the "lead with the thesis,
not the list" rule above governs how it gets used.

## Non-goals

- No paid acquisition, no launch-day theater, no "Product Hunt strategy".
- No claiming Paseo's community, sponsors, testimonials, or metrics as Otto's.
- No hosted/paid tier marketing, and no "Otto Cloud". The model is fixed and worth stating
  plainly: the app is hosted, the daemon is yours, there is no login and nothing to sign up for.

---

## Companion document: feature-inventory.md

# Feature inventory: what Otto adds beyond Paseo

Companion to [marketing-strategy.md](marketing-strategy.md). **Not published anywhere yet**: not on
otto-code.me, not in `public-docs/`, not in the README. This is the source material for those, held
here until the accounting is settled enough to release.

**As of:** 0.7.0 (2026-07-25). **Fork point:** `cd8ad1785` (2026-07-03, "Rebrand Paseo → Otto"):
2,412 files changed, ~350k insertions since.

**How it was verified.** Every entry was checked against `git ls-tree -r --name-only cd8ad1785` to
confirm the subsystem did not exist at the fork point. Sources: `CHANGELOG.md` 0.3.0→0.7.0 (135
`Added` + 100 `Improved`/`Changed` bullets), the `docs/` tree, and the founding batch that predates
the changelog (`573d3ce68`, "Otto fork foundation": preview subsystem and the OpenAI-compatible
provider landed before independent versioning started at 0.3.0). Bug fixes and cosmetic polish are
excluded.

**One item has mixed parentage** and is marked inline: the pluggable forge layer came from upstream
(`a8ebd390f`); Otto took theirs and ported its Bitbucket Cloud adapter onto it. See
[docs/upstream-merges.md](../../docs/upstream-merges.md) § Standing decisions. Everything else here
did not exist at the fork sha.

**When using this for copy**, the charter's rule holds: lead with the observability thesis, not the
list. The list is the proof, not the pitch.

**Keeping it current.** This is a point-in-time count, not a live ledger. Re-derive it at a release
boundary rather than appending to it per-PR. The verification step above is what makes it credible,
and an entry added without it is a claim rather than a fact.

---

## Preview & browser verification (10)

1. Dev servers started from a per-project `launch.json`
2. Agents verify rendered changes in a real Otto browser tab
3. Accessibility-tree page snapshots
4. DOM inspection and JS evaluation
5. Console message + network request capture
6. Server log tailing
7. Click / type / form-fill / hover / drag interaction
8. Viewport + colour-scheme resize (mobile / tablet / desktop, light / dark)
9. Screenshots and region zoom
10. Daemon-enforced tab binding: agents cannot escape their tab

## Visualizer (21)

11. Live node graph of agents, subagents, tool calls and messages
12. Provider-neutral: works for Claude, Codex, Copilot, OpenCode, Pi, local
13. File-attention heatmap
14. Opens from any chat, or scoped to a single run
15. Timeline replay with play/scrub
16. Sound effects for spawns, tool calls, completions, errors
17. Volume slider and persisted mute
18. Per-personality voice cues (join / first-think / finish), AI-generatable
19. Speech button in the workspace header to silence cues
20. Node shape picker: hexagon, square, octagon, circle
21. Context-composition readout as a ring or a segmented bar
22. Discovery cards
23. Independent per-node glow and full-scene bloom toggles
24. FPS meter
25. Display + sound toolbar
26. HUD hide and full-overlay hide
27. Picture-in-picture viewport: draggable, two sizes
28. Demo scenario loader (graph preview without live agents)
29. Automatic bloom disable without GPU acceleration
30. Background tabs stop consuming CPU/GPU
31. Whole subsystem switchable off

## Agent personalities (12)

32. Named per-host templates: provider→model, effort, mode, prompt, roles, colour, voice
33. Seven roles
34. Starter team of six on every new host, restorable
35. Running agents show personality name, icon and coloured spinner
36. Switch a running agent's personality from the model picker
37. Personality submenu in the model picker
38. Spawn-snapshot lifecycle: orchestrating agents spawn by personality
39. Personality memory: accrued lessons, injected per run
40. Read, edit and delete lessons
41. Transfer lessons to another personality on delete
42. Personality editor tabs: Identity / Personality / Model / Voice
43. Artifacts and schedules record the personality that generated them

## Agent teams (6)

44. Group personalities into switchable operating templates
45. Instant team switcher in the sidebar
46. "Team's Role" slots across personality, model, artifact and schedule pickers
47. Team-default personality on new chats
48. Team outranks a remembered personality
49. Team avatars

## Orchestration (11)

50. Teams orchestrate multi-phase work autonomously
51. Runs view to watch each orchestration
52. Nodes declare output fields and `submit_output`
53. Conditional edges
54. Per-node tool authority and query tools
55. Per-node retry limits
56. Per-node time limits
57. Prompt templates
58. Three-valued node result
59. Per-node workspace reach
60. Cancelling a run stops the children it started

## Subagents & background work (11)

61. Claude subagent tasks as their own watchable rows
62. Workflow fan-out as read-only observed subagent rows
63. Real per-subagent token and cost at any nesting depth
64. Parent cost de-inflated: no double-counting of children
65. Stop or archive a subagent from its row
66. Finished subagents collapse into a group, with clear-all
67. Auto-clear settled subagents, totals still counted
68. Per-row runtime and token cost
69. Rows titled by task, led by personality name
70. Agent-started background tasks: monitor, stop, clear without leaving the chat
71. A Claude Workflow run decomposes into one row per agent it spawns

## Accounting & context (17)

72. Total token accounting: one lifetime in / cache / out split per chat
73. Cost reported by the provider or blank, never rate-table estimated
74. Chat metrics bar above the composer
75. Usage & cost Summary with real cost beside tokens
76. Split across main chat / generations / sub-agents / compaction
77. Usage Log tab: itemized per-agent ledger grouped under the turn that spawned it
78. Reset usage counters and ledger
79. Activity Stats screen: daemon-wide counters, day buckets, retention policy
80. Live turn stats: elapsed timer and token count
81. Context usage ring with breakdown, persisted across restarts
82. Live context usage during a turn for OpenAI-compatible providers
83. Context Management tab: six-category inventory of everything sent before you type
84. Percent-of-window as the severity unit
85. "Worth fixing" findings that jump to the offending lines
86. Always load ↔ Link only control
87. Fixed-context warning above the composer, with its own toggle
88. Rate-limit fly-out naming your actual provider, dismissed until it escalates

## Editor (14)

89. Open and edit files in workspace tabs
90. Live preview and split view
91. Jump to any symbol or line
92. Jump to any file by name
93. Project-wide search and replace, with a large-replace warning
94. In-file search with case, whole-word and regex
95. Select code and ask an agent to refactor it
96. Status bar: language, cursor position, size, line endings
97. Configurable ruler column
98. Unified file tab and mode bar
99. Dirty guard
100.  File Editor keyboard shortcut scope
101.  Preview any file on the machine, including outside open projects
102.  Out-of-project editing gated behind project links

## Code intelligence (10)

103. Go to definition (LSP-first, ctags fallback)
104. Hover types
105. Find all references
106. Project-wide rename
107. Diagnostics from your language server in the gutter and a problems panel
108. Linter diagnostics through the same path (oxlint as a language server)
109. Refine: reviewed AI prose rewrite as its own job tab
110. Refine's multi-file working set: documents vs read-only references
111. Propose-then-accept invariant, nothing written unreviewed
112. Create, rename, delete and move files from the explorer

## Solution view (3)

113. .NET solution lens: the tree as the build system sees it
114. Portable IL sidecar (257 KB) for solution/project evaluation
115. Solution picker and switcher, default off, off does no work

## Document rendering (9)

116. Mermaid diagrams on every surface and platform
117. AsciiDoc files render as formatted documents
118. Relative image resolution in markdown and AsciiDoc
119. Embedded HTML translated rather than printed raw
120. Alt-text fallback for images that can't load
121. Repo-document preview cannot reach the network
122. Checkable task lists in markdown files
123. Automatic language detection for untagged code blocks
124. Material icon theme for the file explorer

## Artifacts & widgets (11)

125. Artifacts screen: generate and organize shareable HTML documents
126. Artifacts open as tabs you can watch, cancel or regenerate
127. Agents create artifacts mid-conversation
128. Agents manage their own artifacts
129. Regeneration keeps the last good version on failure
130. Read-only transcript of the generation chat behind an artifact
131. Artifacts from the mobile workspace menu
132. Inline widgets: `show_widget` puts interactive HTML in the conversation
133. Three widget sandboxes: Electron webview, web MessagePort, native
134. `sendPrompt` from inside a widget
135. Widgets have no network at all

## Git & changes (14)

136. Commit changed files from the Changes panel, choosing which to include
137. AI commit messages from a matching Writer personality
138. Roll back individual files
139. Git Log tab with commit history
140. Per-file git history: every commit that touched it and what each changed
141. Blame: who last wrote each line
142. Fork-point diff base, so a busy base branch stops inflating the diff
143. Per-worktree base branch override for stacked branches
144. Bitbucket Cloud PRs and issues: **adapter ours, forge layer upstream's**
145. Per-request Bitbucket auth, never logged; daemon re-checks merge preconditions
146. Add a file to the conversation from the Changes view
147. Commit / push / PR / merge locked during a branch switch
148. Setting to hide "merge into base branch" for PR-only workflows
149. Discard warns and holds while an agent is working in that folder

## Workspaces & projects (11)

150. Worktree archive with branch cleanup: detect, ask, act, reporting merge state and commits at risk
151. Re-open an archived worktree, recreated from its branch if the folder is gone
152. Open a worktree's base checkout from the workspace menu
153. New Project page: scaffold as one daemon-owned transaction with per-provider remote creation
154. Workspace scripts run as real terminal tabs with their own environment
155. Choose how many workspaces stay loaded in the background
156. Workspace tab overflow menu
157. Optional vertical tab rail per pane
158. Blocked creating a second workspace on a folder already backing a live one
159. Project links for cross-project file access
160. Manage context reachable from every workspace row and the workspace menu

## Providers (14)

161. Natively-tooled OpenAI-compatible provider: daemon-owned tool loop
162. MCP client for OpenAI-compatible providers, connecting in parallel
163. `/compact` and auto-compact for OpenAI-compatible providers
164. Conversation rewind for OpenAI-compatible providers
165. Reasoning effort for OpenAI-compatible providers
166. Resume with full history
167. Web search toggle, with localhost/private-network blocking and a permission gate
168. Image attachments
169. Max tool-round limit
170. Otto tools injected with per-tool permission prompts
171. Provider endpoint history: re-pick a URL instead of retyping
172. Provider settings split into Connection / Models / Tools
173. One consistent "Effort" control across every provider
174. MCP prompts as composer slash commands

## Safety & unattended (7)

175. Deny-by-default posture for scheduled and background runs
176. `dontAsk` mode
177. Auto/Haiku coercion
178. The deny-responder
179. Auto-approved edits stay inside your workspace folder
180. Stronger DNS-rebinding and internal-address protection
181. Stopping a preview server only works for recognized workspace servers

## Composer & chat (17)

182. AI-generated chat titles from your first message
183. Predicted next prompt as ghost text, Tab to accept
184. Up/Down recalls messages you've already sent
185. Escape clears an unsent message, Escape again cancels the agent
186. Steer queue: messages queued while an agent works arrive together on its next turn
187. Typewriter streaming reveal with a live turn token count
188. Tool calls show one friendly name everywhere they appear
189. Runs of actions group into one collapsible summary
190. File links in chat open in a side pane
191. Open task checklist showing which item is in progress
192. Pin the task list above the chat; it closes itself when everything is done
193. Suggested-task chips
194. Four suggested-task start modes: new chat, sub-agent, worktree, in session
195. Detail cards rise from behind the message box
196. Composer stays smooth while an agent streams
197. Delete an archived chat, or clear all of them at once
198. Focus mode caption strip

## Speech & voice (8)

199. Playback button on each agent message
200. Auto-speech queue that plays in order with defined interruption rules
201. Punctuation pauses synthesized as PCM silence
202. Speech reads the rendered text, not raw markdown
203. Volume slider on its own audio channel
204. Kokoro v1.0 voices
205. Speech settings split into Dictation / Voice / OpenAI
206. Three audio channels that never mix: replies, cues, Visualizer

## Onboarding & UI (17)

207. Guided first-time setup: detects providers, picks an interface style, seeds personalities and teams
208. User mode: simplified interface with a Files-only explorer
209. Tutorial spotlight
210. Send feedback from inside the app
211. Text Effect themes for the working indicator (Wave, Flames, Matrix and others)
212. Animated page transitions, with a toggle
213. Font-size slider
214. Font-contrast control for reading ink
215. Black tab background option
216. Gradient toggle for chat bubbles
217. Right-click menus on sidebar rows
218. Drag to resize the settings sidebar
219. Expand / collapse all sidebar groups
220. Pin pane tab tools
221. Keybinding customization, with tooltips showing your remapped keys
222. Switchable exact / relative timestamps
223. Feature flags: turn a subsystem off so its code never loads

## Schedules (4)

224. Stop after a set number of runs, or run forever
225. Schedules remember and show the personality, provider and model that last ran them
226. Card layout with project filter and a Failed tab
227. Read-only transcript of a schedule's last run

## Platform, ops & release (11)

228. macOS desktop builds attached to releases
229. Linux software-rendering fallback, AppArmor profile and crash dialog
230. Linux .deb/.rpm put `otto` on PATH automatically
231. Linux icon sizes up to 512px
232. WSL daemon auto-binds to Windows clients with no manual setup
233. Quit confirmation with active sessions
234. Desktop recovers on its own when the local host restarts
235. Client resource reporting: frame timing, retained-state census, daemon-traffic accounting
236. Performance monitoring off switch
237. Independent versioning and the fork's own release/update channel
238. Marketing-site capture pipeline (`demo` / `demo:real` / `demo:assets`)

---

## Not counted above

Real work, but infrastructure rather than a feature someone would read on a landing page:

- Eight-locale i18n coverage of everything above
- The three-tier Playwright E2E suite (122 specs plus a CI drift guard)
- zod-aot generated inbound protocol validation
- The documentation system (`docs/` + Otto Knowledge; the former `archdocs/` site is retired, its unique content folded into Otto Knowledge)

---

## Companion document: website-showcase.md

# Website showcase: the twelve sections and the assets that prove them

Companion to [marketing-strategy.md](marketing-strategy.md) and
[feature-inventory.md](feature-inventory.md). Where the inventory is the **accounting** (238
verified items in 21 subsystem groups), this page is the **staging plan**: how those groups collapse
into twelve landing-page sections, and exactly which capture produces each image.

**Status is not here.** Progress lives in the 🟡 _Site demos: the scenario backlog_ entry in
[`projects/README.md`](../README.md#testing--tooling), which is the single ledger. This page is the
plan that entry tracks against.

**The pipeline is [docs/site-demos.md](../../docs/site-demos.md).** Every rule there applies: one
run one feature, the whole frame is the demo, fill every form before photographing it. Nothing below
overrides it.

---

## The argument

The landing page today sells Paseo's foundation across six separate sections and Otto's own work
across five hand-drawn simulations. That inverts the story. Consolidated, the base becomes one
confident section at the end (_look how solid the ground is_) and the eleven sections above it are
Otto's. Otto Brain landed later as §10, making twelve.

Two ordering rules decided this sequence:

1. **Visual wow first, depth second, foundations last.** A visitor decides in one scroll.
2. **Differentiated before merely good.** §1, §2 and §9 are the three nobody else ships. Everything
   else is evidence the product is finished, and must not be laid out as ten equal tiles beside them.

---

## Section order

Each row lists the [feature-inventory](feature-inventory.md) groups it draws from, so a section's
claims stay traceable to verified items.

| #   | Section                      | Inventory groups drawn from                                                                 |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | The Visualizer               | Visualizer (21)                                                                             |
| 2   | Agents that prove their work | Preview & browser verification (10)                                                         |
| 3   | A team of agents, by name    | Agent personalities (12), Agent teams (6), Orchestration (11)                               |
| 4   | Work that runs without you   | Artifacts (part of 11), Schedules (4), Subagents & background (11), Safety & unattended (7) |
| 5   | An IDE, not a chat box       | Editor (14), Code intelligence (10), Solution view (3)                                      |
| 6   | The interface you live in    | Composer & chat (17), Document rendering (9), widgets (part of 11), Onboarding & UI (17)    |
| 7   | Know what it costs           | Accounting & context (17)                                                                   |
| 8   | Review, preview, ship        | Git & changes (14), Workspaces & projects (11)                                              |
| 9   | Bring any model              | Providers (14)                                                                              |
| 10  | Otto Brain                   | **No inventory group yet.** See the note below                                              |
| 11  | Voice                        | Speech & voice (8)                                                                          |
| 12  | Built on Paseo               | Platform, ops & release (11), plus the whole upstream foundation                            |

§10 is the one row that does not trace back to
[feature-inventory.md](feature-inventory.md): Otto Brain shipped after the 238-item accounting was
taken, so it has no group there. Its claims currently rest on `packages/brain/src/cli.ts` directly
(`start`/`stop`/`restart`/`status`, `pull`/`search` against Hugging Face, `calibrate`, `bench`, the
owned llama.cpp runtime). **Add a Brain group to the inventory and point this row at it**, or the
section is the only unverifiable one on the page.

§12 absorbs six sections that exist today and are all upstream: `SelfHostedSection`,
`MultiProviderSection`, `SplitPanelsSection`, `ShortcutsSection`, `ServiceProxySection`,
`CLISection`, plus the credit copy currently in `BuiltOnOpenSourceSection`. The Agent Flow credit
moves up into §1 as a one-line link, because that is where the visitor is looking at Simon's work.

---

## WebsiteHero

One full-frame asset, above the fold, and the only full-size image on the page. Everything else is a
focus crop.

**It is a looping capture, not a still.** The mockup it replaces animates: the six-dot
`SyncedLoader` spinning is what makes the hero feel alive, so the replacement must move
too. Capture video, loop it silently, and let the motion come from a real agent mid-turn: spinner
spinning, tokens streaming, a tool row landing.

**Staging.** No third template repo. `mango-storefront` is already the photogenic one and gets a
curation pass instead (below). In frame, all of it in a good state because the whole frame is the
demo:

- Sidebar: both staged repos, several workspaces, at least one with a live status dot.
- Main pane: a chat mid-turn, real provider content, a personality name and colour on the running agent.
- Second pane: the diff or the browser pane, something with visible colour, never a terminal wall of text.
- Title bar, composer and tab row all consistent with a turn in progress.

**Producing scenario:** `00-website-hero` (absorbs today's `hero-shot`). Twilight only.

### The curation pass on `mango-storefront`

The hero and roughly half the focus shots photograph this repo's file tree, diffs and editor
buffers, so its contents are site copy. Requirements:

- **Filenames read as a real product.** `Header.jsx`, `Hero.jsx`, `ProductGrid.jsx`, `CartBadge.jsx`
  already do. Nothing named `test2.js`, nothing left at `App.jsx` doing everything.
- **Comments are written to be read at 2.5× zoom.** Short, sentence-case, explaining intent rather
  than restating the line. They will be legible in every editor and diff shot.
- **The uncommitted working changes tell one story**, not five unrelated edits. The diff panel is
  photographed in §8 and must read as a coherent piece of work.
- **Commit messages are plausible and well-formed.** They appear in Git Log, blame and file-history
  shots.
- **No lorem ipsum, no placeholder copy** anywhere that renders in the browser pane, because §2 photographs
  the running storefront.

`pulse-api` needs the same pass at lower priority; it backs the test-running and suggested-task
beats rather than the marquee shots.

---

## The shot manifest

`kind` is `full` (one only), `focus` (a crop of one surface) or `loop` (silent looping video).
Asset convention: `packages/website/public/shots/<id>.png` or `.webm`, a **committed** directory,
hand-picked out of the gitignored `public/demos/` run output. The site is dark-only, so **Twilight
only**; no Daylight pass is needed for any of these.

`(new)` in the scenario column means that scenario does not exist yet.

| Shot id              | §    | Kind  | Producing scenario                            |
| -------------------- | ---- | ----- | --------------------------------------------- |
| `hero-desktop`       | hero | full  | `00-website-hero`                             |
| `viz-graph`          | 1    | loop  | `08-visualizer`                               |
| `viz-node`           | 1    | focus | `08-visualizer`                               |
| `viz-pip`            | 1    | focus | `08-visualizer`                               |
| `preview-verify`     | 2    | loop  | `02-preview-verify` (Electron)                |
| `preview-proof`      | 2    | focus | `02-preview-verify`                           |
| `preview-console`    | 2    | focus | `02-preview-verify`                           |
| `team-roster`        | 3    | focus | `04-personalities`                            |
| `team-switcher`      | 3    | focus | `05-agent-teams`                              |
| `team-runs`          | 3    | focus | `23-orchestration-runs` (new)                 |
| `team-memory`        | 3    | focus | `23-orchestration-runs` (new)                 |
| `auto-artifacts`     | 4    | focus | `13-artifacts` (new)                          |
| `auto-artifact-tab`  | 4    | focus | `13-artifacts` (new)                          |
| `auto-schedules`     | 4    | focus | `14-schedules` (new)                          |
| `auto-suggested`     | 4    | focus | `09-composer-intelligence`                    |
| `ide-definition`     | 5    | focus | `19-editor-ide` (new)                         |
| `ide-diagnostics`    | 5    | focus | `24-code-intelligence` (new)                  |
| `ide-rename`         | 5    | loop  | `24-code-intelligence` (new)                  |
| `ide-solution`       | 5    | focus | `24-code-intelligence` (new)                  |
| `ui-widget`          | 6    | focus | `22-widgets` (new)                            |
| `ui-tasklist`        | 6    | focus | `01-agent-live`                               |
| `ui-mermaid`         | 6    | focus | `22-widgets` (new)                            |
| `ui-themes`          | 6    | focus | `12-themes` (new, triptych of 3 themes)       |
| `cost-context`       | 7    | focus | `20-context-cost` (new)                       |
| `cost-ledger`        | 7    | focus | `20-context-cost` (new)                       |
| `cost-metrics`       | 7    | focus | `20-context-cost` (new)                       |
| `ship-diff`          | 8    | focus | `03-diff-review`                              |
| `ship-commit`        | 8    | focus | `10-diff-ai-review` (new)                     |
| `ship-blame`         | 8    | focus | `25-git-history` (new)                        |
| `ship-worktree`      | 8    | focus | `18-worktrees` (new)                          |
| `model-local`        | 9    | focus | `17-multi-provider` (new)                     |
| `model-local-verify` | 9    | loop  | `02-preview-verify`, `DEMO_PROVIDER=local-ai` |
| `brain-dashboard`    | 10   | focus | none yet                                      |
| `voice-mode`         | 11   | loop  | `21-voice` (new)                              |
| `voice-playback`     | 11   | focus | `21-voice` (new)                              |
| `paseo-panes`        | 12   | focus | `15-workspace-layouts` (new)                  |

**36 shots: 1 full frame, 30 focus, 5 loops.** The full frame is itself captured as a loop, so six
assets are video. Twelve already have a producing scenario; the rest need one. `brain-dashboard` is
the only row with no scenario named at all, so it renders the amber _no scenario yet_ marker
on the live page until one is authored. Verified against the rendered page:
`document.querySelectorAll('[data-shot-placeholder]')` returned 34 before Otto Brain landed and
should now return 35, the hero being the one slot still filled by the old mockup.

### Cheapest wins first

- `model-local-verify` is the single highest-value shot per unit of work in the table: it is
  `02-preview-verify` re-run with one environment variable flipped, and it is the proof that §2 is
  not Claude-only. Build nothing, spend one run.
- `feature-spread.spread.ts` is a **declarative surface list**: adding a surface is a route plus a
  name. `cost-context`, `cost-ledger`, `ide-solution` and `paseo-panes` are all reachable that way
  without authoring a narrative scenario.
- `13-artifacts` and `14-schedules` are free of provider tokens **if the seeder plants the files**,
  as already noted in the ledger.

---

## What the landing page loses

Five hand-built simulations come out. Each shows a surface that is not Otto's, and three assert
outcomes that no code produces:

| Removed                      | Why                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `WorkflowSection`            | Fake browser, grey rectangles, an invented `checks passed` chip                     |
| `SplitPanelsSection`         | Four grey tiles labelled Agent / Browser / Terminal / Diff                          |
| `PreviewVerificationSection` | A hand-written checklist of things the agent "did"; no Otto surface looks like this |
| `PersonalitiesSection`       | Hardcoded starter-roster cards that are not the real picker                         |
| `LocalVoiceSection`          | A 48-bar CSS waveform and a scripted word-by-word transcript                        |

`HeroMockup` is a sixth: a 1,005-line React replica of the whole desktop UI. It stays on disk and
keeps rendering behind a single flag until `hero-desktop` exists, then goes.

**What survives is the framing.** [docs/site-demos.md](../../docs/site-demos.md) already settled
this (_"Bare web app capture; window chrome is the site's job"_) so the polish these components
carry becomes the frame around real captures rather than the content inside them. Two things in the
absorbed sections are also honest and stay: the self-hosted bezier diagram (a diagram, labelled as
one) and the CLI code blocks (real commands).

---

## Placeholders as the backlog

Until an asset exists, `<FeatureShot>` renders a correctly-proportioned placeholder carrying its
shot id, kind and the producing scenario. The landing page is therefore its own capture checklist,
and no section can point at an asset with no producer. The site deploys manually
(`npm run deploy`), so placeholders cannot reach production by accident, but the page should not be
deployed until at least the hero and §1 to §3 have real assets.

## Timeline

- time: "2026-08-08T06:17:56.235Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:56.235Z"
  kind: "evidence"
  summary: "Migrated from `projects/marketing-strategy/marketing-strategy.md` and the legacy `projects/README.md` ledger. Legacy status: Charter. Ledger summary: Otto's public voice (Philippe, first person) and the channels still to create. Companions: [feature-inventory.md](marketing-strategy/feature-inventory.md) - the verified full accounting of what Otto adds beyond Paseo (238 items as of 0.7.0), **held locally, published nowhere yet**; [website-showcase.md](marketing-strategy/website-showcase.md) - how those 21 groups collapse into eleven landing-page sections, the 34-shot manifest and the `WebsiteHero` staging definition"
- time: "2026-08-08T06:19:48.173Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
