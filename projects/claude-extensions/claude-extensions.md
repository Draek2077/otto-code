# Claude Extensions — charter

Status: **not started**. Scope approved by the product owner 2026-07-25: **Claude-only, in the Claude
provider settings panel.**

## What this is

Full management of the Claude Code extension surface from inside Otto — plugins, marketplaces,
skills, and MCP servers — so a host's agent capabilities can be inspected and changed from the phone
without SSHing in and running `claude` interactively.

Today Otto can _see_ the result of this configuration (skills and commands show up in the composer's
slash menu) but cannot change any of it.

**Management is the floor, not the goal.** A settings screen that only mirrors the CLI saves an SSH
session and little else. The reason this is worth a wave slot is what Otto can do that the CLI does
not: total the always-on token cost across everything installed, distinguish what is installed from
what a running agent actually loaded, turn MCP failures into a cause and a next action, and host the
plugin authoring loop in an environment that already has an editor. Those are §"Beyond management"
below, and they are what the phases are ordered around.

## Scope decision (already made)

**This is Claude-only and that is deliberate.** The fork's standing rule is to design
provider-agnostic first and treat single-provider support as the proof rather than the finish line.
That rule is being consciously set aside here, for a reason that holds:

- Plugins and marketplaces are a **Claude Code product concept**, not a general agent concept. Codex
  has `~/.codex/prompts/` and AGENTS.md; OpenCode has npm plugins plus `.opencode/command|agent`;
  Copilot and Pi have no comparable installable-extension model. There is no shared abstraction to
  find, only a lowest common denominator that would serve nobody.
- Claude is Otto's first-rate provider. Depth here is worth more than breadth that does not exist.

Consequences to accept up front:

- The UI lives in the **Claude provider settings panel**, gated to `provider === "claude"`. It does
  **not** go in the host-wide Agents section, which would falsely imply it affects every provider.
- Naming stays Claude-native: **Plugins**, **Marketplaces**, **Skills**, **MCP**. No invented
  provider-neutral umbrella term in the UI — per [docs/glossary.md](../../docs/glossary.md), the
  label users already know from the CLI wins.
- If a second provider ever grows an installable-extension model, this becomes an adapter. It is not
  designed as one now, and no speculative adapter seam gets built.

## Current state — what exists on the host

Verified on Windows against the installed CLI, 2026-07-25.

### Plugins have a scriptable CLI — mostly machine-readable

`claude plugin` is fully non-interactive. That is the load-bearing finding of the whole charter: no
TUI to drive, no interactive prompts to fake. Machine-readability is good but **not uniform** — `list`
and `eval` emit JSON, `details` does not:

| Command                                        | Notes                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `plugin list --json`                           | Installed set                                                                 |
| `plugin list --available --json`               | `{ installed: [...], available: [...] }` — the full catalog                   |
| `plugin details <name>`                        | Component inventory **and projected token cost** — **text only, no `--json`** |
| `plugin eval <target> --json [path]`           | Scored eval runs with a no-plugin baseline arm                                |
| `plugin install\|uninstall <name>`             | `plugin@marketplace` id form supported                                        |
| `plugin enable\|disable <name>`                | Enable/disable without uninstalling                                           |
| `plugin update <name>`                         | **"restart required to apply"**                                               |
| `plugin validate <path>`                       | Manifest validation                                                           |
| `plugin init <name>`                           | Scaffolds into `~/.claude/skills/<name>/`                                     |
| `plugin prune`                                 | Removes orphaned auto-installed dependencies                                  |
| `plugin marketplace add\|list\|remove\|update` | Source is a URL, path, or GitHub repo                                         |

`list --json` entry shape: `{ id, version, scope, enabled, installPath, installedAt, lastUpdated }`,
where `id` is `name@marketplace` and `scope` is `user` or `project`.

**`details` is the exception and it matters.** It is the only source of the component inventory and
the token cost, and it emits text, not JSON. Actual output:

```
Component inventory
  Skills (0)
  Agents (1)  code-simplifier
  Hooks (0)
  MCP servers (0)
  LSP servers (0)

Projected token cost
  Always-on:   ~64 tok   added to every session

Per-component (rounded)
  component        always-on  on-invoke
  code-simplifier        ~60       ~910
```

So the richest data in the whole surface — per-component always-on vs on-invoke token cost — is the
least machine-readable. §"Reading `details`" below is the decision that forces.

On disk, under `~/.claude/plugins/`: `installed_plugins.json` (v2 — id → array of install records),
`known_marketplaces.json` (name → `{ source: { source: "github", repo }, installLocation, lastUpdated }`),
`plugin-catalog-cache.json` (~400 KB on a two-marketplace install), plus `marketplaces/<name>/`
clones and `cache/<marketplace>/<plugin>/<version>/` install trees.

### MCP does not have one

`claude mcp` covers `add`, `add-json`, `add-from-claude-desktop`, `get`, `list`, `login`, `logout`,
`remove`, `reset-project-choices`, `serve`. **`list` and `get` have no `--json` flag** — they emit
human-formatted text with health-check status and `⏸ Pending approval` markers for unapproved
`.mcp.json` servers. This asymmetry with `plugin` is the single biggest source of work in the whole
charter, and §"MCP reads" below is the decision it forces.

`mcp add` flags: `-t/--transport stdio|sse|http`, `-s/--scope local|user|project`, `-e/--env KEY=value`
(repeatable), `-H/--header` (repeatable), `--client-id`, `--client-secret` (prompts, or
`MCP_CLIENT_SECRET`), `--callback-port`.

Config lives in `~/.claude.json` under `mcpServers` (user/local scope) and in per-project `.mcp.json`.

### What Otto already has

- **The slash-command read path.** `listCommands()`
  ([agent.ts:2980](../../packages/server/src/server/agent/providers/claude/agent.ts:2980)) already
  surfaces commands and skills to the composer. `classifyClaudeSlashCommand`
  ([agent.ts:395](../../packages/server/src/server/agent/providers/claude/agent.ts:395)) carries the
  note that Claude exposes commands and skills as **one flat SDK list with no structured source** —
  so today Otto cannot say which plugin a given skill came from. Plugin management supplies exactly
  that missing attribution.
- **A binary resolver.** `resolveClaudeBinary(runtimeSettings)`
  ([agent.ts:1844](../../packages/server/src/server/agent/providers/claude/agent.ts:1844)) is how the
  daemon already locates `claude`. The adapter reuses it; it must not grow a second resolution path.
- **A tabbed provider settings sheet.** `provider-diagnostic-sheet.tsx` builds its tabs in
  `buildProviderTabOptions`
  ([provider-diagnostic-sheet.tsx:94](../../packages/app/src/components/provider-diagnostic-sheet.tsx:94)),
  already conditionally per provider: `connection | models | tools | agents`. New tabs slot in here.
- **An overlapping open item.** [context-management](../context-management/context-management.md)
  carries "skills/MCP toggles" in its open tail — per-agent _enablement_ of what is already
  installed. That is a different axis from this charter's _installation_ management, but the two
  surfaces must agree on vocabulary and must not both grow their own list of installed skills.

## The design

### Where it goes

Two new tabs on the Claude provider settings sheet, both gated to `provider === "claude"` in the
same conditional style the `tools` and `agents` tabs already use:

- **Plugins** — installed list, marketplace browser, marketplace sources.
- **MCP** — configured servers, add/remove, health.

The sheet is already 2120 lines. Each tab gets its own component file
(`provider-plugins-tab.tsx`, `provider-mcp-tab.tsx`) rather than growing the sheet further; the sheet
only learns the two new tab values and renders them.

Skills are **not** a third tab. Plugin-provided skills are shown inside the plugin's detail view; the
loose `~/.claude/skills/` directory gets a section within the Plugins tab, since `claude plugin init`
scaffolds there and installed plugins from `skills-dir` already resolve as `<name>@skills-dir`.

### The daemon adapter

One module, `packages/server/src/server/agent/providers/claude/extensions.ts`, wrapping the CLI:

- Resolve the binary via the existing `resolveClaudeBinary`.
- Shell out with `execFile` (never a shell string — marketplace ids and server names are user input).
- Parse `--json` where it exists; parse text only where it does not (see below).
- Normalize every mutation to `{ ok, message, requiresRestart }`.

**Never** hand-edit `installed_plugins.json` or `known_marketplaces.json`. The CLI owns those files
and their v2 shape will change; writing them directly is how this feature silently breaks on a Claude
Code upgrade. Reading the catalog cache for browse performance is acceptable; writing anything is not.

### MCP reads — the forced decision

Because `mcp list`/`get` emit no JSON, there are three options and the charter picks one:

1. **Parse the text output.** Cheap now, brittle forever — the output carries health status and
   emoji-prefixed approval markers that will be reformatted without notice.
2. **Read the config files directly** (`~/.claude.json` → `mcpServers`, project `.mcp.json`) for the
   _inventory_, and use the CLI only for _mutations_.
3. **Wait for an upstream `--json`.** Not actionable.

**Pick 2, with one caveat.** Config files give a stable, structured inventory (name, transport,
command/url, env keys, headers, scope) and are the same files the CLI writes. What they cannot give
is **live health** — whether a server actually connects — which only `mcp get` health-checks. So:
inventory from config files, and health as a _separate, explicitly optional_ per-server probe that
runs `mcp get <name>` and reports only a coarse reachable/unreachable/pending verdict from a narrow
match. If that text-matching breaks, health degrades to "unknown" and the inventory keeps working.
Health is never on the critical path for rendering the list.

### Reading `details`

Same shape of problem as MCP, different answer, because the two data it carries have different
robustness needs.

- **Component inventory** (which skills, agents, hooks, MCP and LSP servers a plugin contributes) is
  **read from the plugin tree at `installPath`**, not parsed from the text. `list --json` already
  gives the path; the tree underneath is just files. This is robust, gives exact component names, and
  is what supplies the plugin → skill attribution `listCommands()` lacks.
- **Token cost** has no file-level equivalent — the numbers are Claude Code's own estimates, and Otto
  re-deriving them with its own tokenizer would produce numbers that disagree with what users see in
  the CLI. So this **is** parsed from the `details` text, narrowly: the `Always-on:` headline and the
  per-component table rows. If the parse fails, cost renders as "unavailable" and the inventory —
  which came from the filesystem — is unaffected.

The rule generalizes across the whole adapter: **structure from files, numbers from the CLI, and no
single parse failure takes down a whole view.**

### The restart problem

`claude plugin update` states outright that a restart is required, and the same is true in practice
for install, uninstall, and enable/disable: Otto's Claude agents are long-lived SDK sessions that
loaded their plugin set at spawn. Changing plugins from your phone mid-run does nothing to the run
in progress.

This must be surfaced, not hidden:

- Every mutation returns `requiresRestart`.
- When it is true **and** the host has running Claude agents, the result banner says so plainly and
  offers **Restart affected agents** as an explicit action — never automatic. Restarting someone's
  agent from a settings screen without asking is exactly the kind of surprise the repo's
  confirm-before-irreversible rule exists to prevent.
- When no Claude agents are running, say "applies to new sessions" and stop.
- After any mutation, invalidate the `listCommands()` cache so the composer's slash menu re-reads on
  the next spawn.

### Secrets

MCP servers take API keys via `-e KEY=value` and bearer tokens via `-H`. Otto is driven from a phone
over the relay, so this is the one part of the feature that moves credentials across the wire.

- Secret-valued fields are entered in the client, sent over the (already E2E-encrypted) relay, passed
  to `execFile` as **argv, not a shell string**, and never persisted in Otto's own config.
- They are **never echoed back**. The inventory read reports env/header **key names only**; values
  render as `••••` and are write-only. This falls out of the design naturally, since the config-file
  read is the inventory source and Otto simply declines to forward the values.
- Secrets must not reach the daemon log. The adapter's command logging redacts `-e` and `-H` values
  and `--client-secret` before anything is written.

### OAuth is out of scope for v1

`claude mcp login <name>` runs an interactive browser OAuth flow against a local callback port.
Driving that from a phone against a daemon on a different machine is a genuinely different feature —
it needs the callback to land somewhere reachable and the consent screen to render somewhere the user
can see it.

v1 therefore: servers requiring OAuth can be **added, listed, and removed** from Otto, and their
unauthenticated state is shown honestly with the message that login must be completed on the host via
`claude mcp login`. `--callback-port` is exposed so a user who _is_ at the host can set it up
predictably. Actually performing the flow from the app is deferred and noted in the open tail.

## Beyond management — what actually helps

Direction set by the product owner 2026-07-25: **anything we can do to help users with these tools is
best.** Install/remove CRUD is the floor, not the goal. A settings screen that only mirrors the CLI
saves an SSH session; the items below are the ones that make Otto a better place to run this than the
terminal is.

Ordered by how much they help, not by how hard they are.

### 1. The context budget — the strongest single reason to build this

`details` reports each plugin's **always-on** token cost, paid on every session, plus **on-invoke**
cost paid each time a skill or agent fires. Nothing in Claude Code totals this across everything you
have installed. Users accumulate plugins over months and have no idea what they are paying before
they type a word.

Otto can total it, rank plugins by always-on cost, and show it where the decision is made — on the
row, next to Disable. That turns an invisible cost into a decision, which is the same move
[docs/token-economy.md](../../docs/token-economy.md) makes everywhere else and the same one
[context-management](../context-management/context-management.md) makes for everything sent before you
type. **The two must share a vocabulary and a unit** (% of context window, per that charter) rather
than each inventing a presentation.

This also gives disable/enable a real purpose: not tidying, but reclaiming context.

### 2. What is actually loaded, versus what is installed

Installed ≠ active. Scope, enablement, and the restart gap all mean the plugin set on disk can differ
from the set a running agent actually loaded. Otto is the only place that knows both — it holds the
agent sessions.

Showing "active in this session" against "installed on this host", with the difference explained
(disabled / project-scope / installed after this agent spawned), answers the question that otherwise
costs someone twenty minutes: _why isn't my skill firing?_

### 3. MCP troubleshooting

"My MCP server isn't showing up" is the single most common failure with this surface, and it has a
small number of causes that are all knowable: the server is in a `.mcp.json` that has not been
approved (`⏸ Pending approval`), it needs an OAuth login that has not happened, its command is not on
PATH, or it starts and immediately exits.

The health probe (§"MCP reads") exists for this. It should not report a red dot — it should report
the cause and the next action. Where the fix is a CLI command that must run on the host, say so
verbatim so it can be copied.

### 4. Discovery that respects the catalog's size

`plugin list --available --json` is ~400 KB across two marketplaces. Browsing that on a phone is
hopeless without help. Beyond search and grouping (already in Phase 3), the cheap high-value move is
**relevance from the workspace**: a repo with `.csproj` files, a `package.json`, or a `pyproject.toml`
implies which language plugins and LSP servers are worth surfacing first. Otto already knows the
workspace.

Deliberately _not_ proposed: AI-generated plugin recommendations. The signal here is structural and
cheap; sending catalog text through a model to rank it costs tokens to answer a question a file glob
answers.

### 5. The authoring loop

Otto is a coding environment, which makes it a more natural home for plugin authoring than the CLI
alone. The pieces already exist: `plugin init` scaffolds into `~/.claude/skills/<name>/`, which
auto-loads next session as `<name>@skills-dir`; the tree is then editable in Otto's own editor;
`plugin validate` checks the manifest; and `plugin eval --json` runs scored eval cases **with a
no-plugin baseline arm** (`--ablation with-without`) so you get a score delta, not just a score, plus
`--max-cost-usd` as a hard ceiling and `--judge-model` to pick the grader.

That is a complete author → test → measure loop, and `eval` is the one part of this whole surface
that emits rich JSON. It was listed as out-of-scope in the first draft of this charter; under the
enablement framing it is promoted to its own phase. It stays **last** — it serves plugin authors,
while phases 1–4 serve everyone.

### 6. Trust on the way in

Adding a marketplace and installing a plugin is running someone else's code and, for MCP, handing it
credentials. The UI should name the source repo, distinguish the official marketplace from a
third-party one, and confirm on marketplace add rather than treating it as a text-field edit. Not a
security feature — an honesty one.

## Phases

Each phase is independently shippable and independently useful.

**Phase 1 — Plugins, read-only, with the cost view.** Adapter + `extensions.claude.plugins.list`.
The Plugins tab renders the installed set with name, marketplace, version, scope, enabled state.
Detail view reads the component inventory from `installPath` and the token cost from parsed
`details` output (§"Reading `details`"), giving both the plugin → skill attribution `listCommands()`
lacks and **the always-on total across all installed plugins** (enablement §1) — the headline number,
shipped in the first phase rather than saved for later. Also the installed-vs-active distinction
(§2), which is nearly free here since the daemon holds the sessions. No mutations.
_~1–2 medium sessions._

**Phase 2 — Plugin mutations.** Enable, disable, install, uninstall, update. The `requiresRestart`
banner and the Restart affected agents action. Confirmation on uninstall. Disable is presented as
reclaiming the context budget Phase 1 made visible, which is what makes the pairing work.
_~1 medium session._

**Phase 3 — Marketplaces and the catalog browser.** `marketplace add|remove|update|list`, plus
browsing `plugin list --available --json`. The catalog is large — search and marketplace grouping are
required, not polish; a flat list of that size is unusable on a phone. Workspace-derived relevance
(§4) rides along here: it is a file glob plus an ordering, not a subsystem. Marketplace add names the
source repo and confirms (§6).
_~1–2 medium sessions — the browser is the largest single piece of UI in the charter._

**Phase 4 — MCP.** Config-file inventory, add (all three transports, all scopes), remove, the
secret-handling rules above, and the **diagnostic** health probe (§3) — cause and next action, not a
red dot. `add-json` backs a "paste a server config" path, which is how most MCP servers are actually
distributed.
_~2 medium sessions._

**Phase 5 — Skills and the authoring loop.** The `~/.claude/skills/` section, `plugin init`
scaffolding into Otto's editor, `plugin validate`, and `plugin eval --json` with the
`--ablation with-without` baseline and `--max-cost-usd` ceiling surfaced as a scored run (§5). Larger
than the first draft's "skills tab" because eval is a real feature, and still last: it serves plugin
authors where phases 1–4 serve everyone.
_~2 medium sessions._

## Protocol

New dotted RPCs per [docs/rpc-namespacing.md](../../docs/rpc-namespacing.md), request/response paired:

```
extensions.claude.plugins.list          extensions.claude.plugins.details
extensions.claude.plugins.install       extensions.claude.plugins.remove
extensions.claude.plugins.setEnabled    extensions.claude.plugins.update
extensions.claude.marketplaces.list     extensions.claude.marketplaces.add
extensions.claude.marketplaces.remove   extensions.claude.marketplaces.update
extensions.claude.mcp.list              extensions.claude.mcp.add
extensions.claude.mcp.remove            extensions.claude.mcp.health
extensions.claude.skills.scaffold       extensions.claude.skills.validate
extensions.claude.eval.run
```

`eval.run` is the one long-running call here — scored eval runs take minutes and cost money. It
streams progress rather than blocking a request/response pair, and it carries the `--max-cost-usd`
ceiling as a required argument rather than an optional one.

One capability flag, `server_info.features.claudeExtensions`, with a single
`// COMPAT(claudeExtensions): added in v0.1.X, drop the gate when floor >= v0.1.X` marker. Per the
feature contract: **no fallback path.** An old daemon simply does not show the tabs.

Wire schemas stay pure structural declarations — no `.transform()`, no `.catch()`. Text-parsing
normalization (the health probe) happens in an explicit post-validation pass in the adapter, never in
the schema.

## Risks and open questions

- 🔵 **CLI surface drift.** The whole feature is a wrapper around another product's CLI. `plugin list`
  and `plugin eval` have `--json` contracts; `plugin details` and `mcp list`/`get` do not. Mitigation
  is the split rule — structure from files, numbers from the CLI, no single parse failure taking down
  a view — but a Claude Code upgrade renaming a subcommand still breaks things. Worth a single
  adapter-level version probe and a clear "unsupported CLI version" state rather than a wall of parse
  errors.
- 🔵 **Token-cost presentation must not fork from context-management.** Both surfaces will show what
  is consuming the context window. One unit, one vocabulary, ideally one component. This is the
  concrete form of the overlap noted below and is the more likely of the two to be got wrong, because
  the numbers come from different sources and will not agree exactly.
- 🔵 **Project-scope plugins and MCP servers are per-workspace, not per-host.** The provider settings
  sheet is a host-level surface. Showing project-scoped entries there is either wrong or needs a
  workspace selector. **Open decision:** v1 should probably show user-scope only and label it, with
  project scope following once the workspace-selection story is settled.
- 🔵 **Overlap with context-management's "skills/MCP toggles".** Two surfaces will describe the same
  installed set. They must share one vocabulary and ideally one read path. Settle this before Phase 4.
- 🟡 **OAuth login from the app** (deferred above). Under the enablement framing this is the largest
  remaining hole: an MCP server that needs OAuth cannot be fully set up from the phone, which is the
  one case where Otto still sends you to the host.
- 🔵 **`plugin eval` costs real money.** It runs agent turns and paid graders. Exposing it from a
  phone needs the cost ceiling to be prominent and pre-committed, not a flag buried in an options
  sheet. Decide the default ceiling before Phase 5, not during it.
- 🔵 **Windows path handling.** Install paths come back as backslashed absolute paths; the daemon runs
  on Windows, WSL, macOS and Linux hosts. The existing WSL path translation used by the file RPCs
  applies and must not be re-implemented locally.
