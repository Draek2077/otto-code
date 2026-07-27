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
- The four-tree documentation system (`docs/`, `projects/`, `findings/`, `archdocs/`)
