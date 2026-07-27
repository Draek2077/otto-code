# Usage playbooks — a scripted starting state for every part of Otto

## The problem

Otto has a lot of surface. Looking at any given part of it means first getting the app into the state
where that part exists: a project with the right kind of code in it, a workspace on a branch, a chat
on a model that can hold a tool loop, an artifact, a schedule, a team. Reaching that state by hand
takes minutes of clicking, is not reproducible, and is the reason a feature gets looked at once and
then not again.

Two audiences want the same thing, for slightly different reasons:

- **An agent working on Otto** needs to reach a state, verify a change against it, and be able to
  reach exactly that state again next session. Without this it is reduced to reading code and
  claiming the UI probably works.
- **A person testing Otto** wants to walk the whole feature set without hand-building fixtures, and
  wants the first-run experience available on demand rather than once per machine wipe.

## What this is

A **playbook** is one command that puts Otto into a named, reproducible starting state. Playbooks are
cumulative where that is natural (a chat needs a workspace, which needs a project) and independent
where it is not (an artifact and a schedule do not need each other).

They run in the **agent lane** — its own daemon port, `OTTO_HOME`, and Metro port, safe to drive
while the installed Otto and the dev Otto are both up. See
[docs/development.md → Lanes](../../docs/development.md).

The runner is `scripts/dev-agent-bootstrap.mjs`, invoked as
`npm run dev:agent:bootstrap -- --stage <stage>`. It is one script on purpose: the alternative is a
folder of near-identical scripts that drift.

## Design rules

These are the constraints that keep the thing from rotting.

1. **Drive the daemon, do not hand-write its state.** A project, a workspace, an agent, an artifact
   and a schedule are all daemon-owned records. The playbook creates them over the same WebSocket
   RPCs the app uses, so it cannot invent a shape the daemon would not have produced, and it breaks
   loudly rather than silently when a schema changes. Only genuinely file-level state
   (`config.json`, the boilerplate repos) is written directly.
2. **Idempotent, or it is not a playbook.** Re-running a stage must land in the same state, not fail
   or duplicate. This is why the workspace stage uses `open_project` (find-or-create) rather than
   `workspace.create` (always-new, and rejected on a directory that already backs a workspace).
3. **Never touch another lane.** No stage may write outside the agent lane's `OTTO_HOME` and the
   sandbox directory. Provider keys are copied _from_ the dev home, never written back to it.
4. **A failure must name its fix.** Every precondition the playbook can check, it checks, and says
   what to do — not what went wrong. The provider preflight is the model: "config.json declares it,
   so the running daemon is stale — restart the lane" beats a bare `Unknown provider`.
5. **Boilerplate is a fixture, not a product.** The generated repos exist to make Otto's features
   have something to act on. They do not need to build, run, or pass anything. They do need to be
   _plausible_ — a real README, real imports, real file layout — because a feature that works on
   `hello.txt` and not on a real tree has not been tested.

## Stage 1 — the starting states (built)

`--stage <name>` (or `1`..`5`). Cumulative.

| Stage       | State                                                             | Needs a daemon            |
| ----------- | ----------------------------------------------------------------- | ------------------------- |
| `fresh`     | No providers, no wizard flags, no projects — the first-run wizard | No (refuses if one is up) |
| `defaults`  | Providers and keys seeded, wizard and tour flags set              | No                        |
| `project`   | + a project registered                                            | Yes                       |
| `workspace` | + a workspace on that project                                     | Yes                       |
| `chat`      | + a chat in that workspace, on a chosen model                     | Yes                       |

`--model` takes `haiku` (Haiku 4.5), `sonnet` (Sonnet 5), `opus` (Opus 5), `qwen` (Qwen 3.6 27B via
the local OpenAI-compatible endpoint), or a raw id with `--provider`. Provider config and API keys
are inherited from the dev home, so a lane that has been bootstrapped can reach every model the
human's Otto can.

Two facts worth keeping, both learned the hard way:

- **Custom providers are registered once, at daemon startup.** Seeding `config.json` while the lane
  is running leaves the daemon unaware of `openai-compatible`. The playbook preflights this.
- **The wizard flag has to be written `true` explicitly.** `migrateSetupWizardFlag` only treats a
  device as an upgrader when the field is _absent_, and the app writes a full blob with `false` on
  first boot — so seeding an empty blob does not skip the wizard.

## Stage 2 — boilerplate projects and real git (in build)

The machinery is built and one template proves it end to end. What remains is authoring the rest of
the corpus.

Built:

- `scripts/playbook-projects.mjs` — the shared materializer: reads a template, lays it down as a git
  repo with a green `main` and one `break/<slug>` branch per declared error scenario, probes the
  toolchain, runs the declared build and test.
- `test-documents/projects/` — the corpus, with its format documented in a README beside it.
- `python-cli` — stdlib-only, 11 unit tests, green on `main`; `break/failing-test` compiles but fails
  a test, `break/syntax-error` fails to compile at all.
- `csharp-solution` — a double-entry ledger across two projects with a `ProjectReference`, carrying
  **both** `Otto.Ledger.sln` and `Otto.Ledger.slnx`, plus the full document dimension: AsciiDoc with
  Mermaid sequence and class diagrams, a project plan, a test plan, a standalone SVG, and a rendered
  HTML statement. `break/type-error` fails with CS0029.
- `java-console` — priority task scheduler using records, enums, streams and a comparator with two
  keys; a dependency-free self-test runner with 13 assertions. `break/type-error` fails javac,
  `break/failing-assertion` compiles and fails the suite.
- `typescript-web` — a latency dashboard: HTML, CSS with dark mode and a reduced-motion guard,
  TypeScript modules run directly by Node, SVG sparklines, 18 `node:test` cases. `break/failing-test`
  widens a tolerance band, `break/syntax-error` fails to parse.
- `--template`, `--branch`, `--verify`, `--keep` and `--list` on the playbook runner.
- `packages/app/e2e/helpers/playbook-projects.ts` — the E2E door onto the corpus, loaded through a
  file URL the way `daemon-client-loader.ts` reaches `packages/client/dist`.
- `scripts/playbook-projects.test.mjs` — the corpus self-test, 40 cases.

Four templates now cover Python, C#, Java and TypeScript/HTML/CSS, and four distinct failure shapes:
a compile error, a type error, a parse error, and a passing build with a failing test.

Remaining: more stacks as they earn their place, and specs that actually consume the corpus.

### The self-test does not run the builds

A full sweep compiles C#, Java, Python and TypeScript and takes minutes — the wrong shape for
something that should run on every change. So the self-test checks structure: manifests are
well-formed, commands are argv arrays, every template has a README and at least one break variant,
every overlay file replaces one that exists in `tree/`, and every overlay actually differs by content.

That last pair is the authoring mistake that really happens — an overlay path with a typo adds a stray
file instead of breaking anything, and a variant that has silently converged on the green tree is an
error scenario that has quietly stopped being one. Build verification stays in `--verify`, where
`expectFailure` inverts on a `break/*` branch so a break that builds clean is reported as a failure.

### Decided: clean slate by default

A scenario has to be reachable without the previous one in the way, and that cannot depend on
remembering a flag — forget it once and you are debugging leftover state instead of the feature. So
every daemon-touching stage tears down the lane's chats, workspaces, projects and sandbox first.
`--keep` composes instead, for the times you genuinely want to add to what is there.

Teardown runs over **RPCs, not file deletion**, which is what lets it work with the lane up. The
`fresh` stage is the exception and still needs the daemon down, because it clears registries the
daemon holds in memory — a good reason to prefer `--stage defaults` and a reset for everyday use, and
keep `fresh` for genuinely testing first-run.

Two properties make default-on safe: reset refuses any home outside `packages/desktop/.dev/`, and
enumeration failures are never swallowed. The second was a real bug — the first implementation passed
a malformed `scope` to `fetchAgents`, got a rejection, and a `.catch()` turned it into "0 chats",
which looks exactly like a clean slate and is not one.

### Decided: both solution formats, one tree

`.sln` is line-oriented with GUIDs; `.slnx` is XML. Anything reading solution structure has to parse
two unrelated grammars, so they are worth exercising separately. Everything downstream of the parse is
identical though, so a second template would duplicate nine files to test one file's grammar and would
drift. Both files therefore sit in the same tree — which is also a realistic mid-migration state — and
every command names one explicitly, since a bare `dotnet build` cannot pick between them.

### The corpus has three consumers, not two

Playbooks, E2E, and **marketing captures** for the website
([docs/site-demos.md](../../docs/site-demos.md)). The third one raises the bar rather than adding a
constraint: a screenshot of `hello.txt` sells nothing, so realism stops being a nicety. It is also why
every template carries documents alongside code — the file viewer, rendered previews and captures all
need something worth looking at.

**A rough edge worth knowing.** A worktree is inherently one-per-branch, so `--branch` cannot be
idempotent the way `open_project` is. Re-running with a branch that already has a worktree is treated
as "the state has been reached" and reported rather than failed — correct in effect, but it returns no
workspace id, so a `chat` stage layered on top of an existing worktree lands in the project's default
workspace instead. Wants a lookup rather than a shrug.

Today's sandbox is one empty repo. That is enough to prove a workspace opens and is not enough to
look at anything else: no syntax highlighting, no meaningful diff, no file tree, no language server.

**Boilerplate projects**, one per language/stack, named for what they are so the project list reads
as a menu — `typescript-react`, `python-fastapi`, `csharp-webapi`, `go-cli`, `rust-cli`,
`html-css-static`, `java-spring`, `php-laravel`, and so on down the supported set. Each is a real git
repo with a real initial commit and a plausible tree: `README.md`, a frontend half and a backend half
where the stack has both, config files, tests.

The templates are checked in; the instances are generated into the lane's sandbox and are disposable.
Templates live under `test-documents/`, which already exists for exactly this category of thing —
hand-authored fixtures that must not be linted or formatted (`test-documents/**` is already in
`.oxlintrc.json`) — as a `projects/<name>/` subtree beside the existing one-file-per-format corpus.

**Workspaces become branches.** A workspace on a boilerplate project is cut as an otto worktree
(`workspace.create` with `kind: "worktree"`, `action: "branch-off"`), which is what makes the whole
git surface real: Changes against a fork-point base, commit, rollback, file history, blame, stash,
branch switch, merge-into-base, worktree archive with branch cleanup.

**Git hosting is out of scope.** No GitHub, no Bitbucket, no PRs, no remotes. Everything is local.
That boundary is deliberate: it keeps playbooks from needing credentials, from making network calls,
and from being able to publish anything.

### Decided: the boilerplate builds

A template is not a pile of syntax-highlighted text. Each one declares how to build, test and run
itself, and that command is expected to succeed on a clean checkout. This is what makes **error
scenarios** reachable: if `main` builds green, then a branch carrying a deliberate mistake produces a
real compiler or test failure, and everything downstream of a failure — diagnostics, the problems
list, an agent asked to fix it, a red preview — has something genuine to react to. A fixture that
cannot fail cannot test failure handling.

So every template ships **two commits at minimum**: a green `main`, and a `break/<what>` branch whose
build fails in a specific, documented way (type error, unresolved import, failing assertion, syntax
error). More breakage branches are welcome; each one is a named error scenario.

Two consequences worth stating up front:

- **Prefer zero-dependency templates.** A template whose build needs a network install is slow, is
  non-deterministic, and rots when a registry moves. Stdlib-only is the default; a dependency has to
  earn its place by being the thing under test.
- **The toolchain may be absent, and that is not a failure.** The manifest names the tool each
  template needs. When it is missing, the playbook materializes the repo — which is still useful for
  highlighting, the file tree, diffs and the editor — and reports the build as skipped rather than
  failing. Confirmed on the current dev machine: Node 24, npm, Python 3.12, .NET 10, JDK 17 present;
  Go, Rust, PHP and Ruby absent.

### Decided: one corpus, shared with E2E

The playbooks and the Playwright suites use the **same** templates through the **same** materializer.
Not two corpora kept in sync — one, imported from both sides.

The reason is the one the request named: an agent driving Otto by hand and a spec asserting about
Otto should be working against identical ground truth. When they diverge, a green suite stops being
evidence that the thing an agent just looked at actually works. Sharing also means a fixture only has
to be authored once, and a new error scenario becomes available to both at the same moment.

The cost is real and worth naming: a spec's need for determinism can start constraining a fixture
whose job is to be realistic. The zero-dependency default is most of the mitigation — a template with
no network install and a pinned toolchain is deterministic without anyone having to trade realism for
it. Where the two genuinely conflict, determinism wins for anything E2E asserts on, and the realistic
variant becomes a separate template rather than a flag on an existing one.

## Stage 3 — feature playbooks (charter)

Beyond the project/workspace/chat spine, each of these is a starting state worth reaching on demand.
Independent of each other; each assumes `defaults` plus whatever project it needs.

| Playbook        | Puts Otto into…                                                                     |
| --------------- | ----------------------------------------------------------------------------------- |
| `artifacts`     | A workspace with artifacts of each kind already created                             |
| `schedules`     | Scheduled runs registered — one due soon, one far out, one paused                   |
| `team`          | The **Otto Crew** default team active, so role routing is live                      |
| `personalities` | Named personalities assigned across several chats                                   |
| `visualizer`    | A session with enough shape to be worth visualizing, in each display mode           |
| `changes`       | A workspace with staged, unstaged and committed work, and a rollback candidate      |
| `editor`        | Files open across tabs, in languages with and without a language server             |
| `preview`       | A boilerplate project with a `launch.json`, dev server startable                    |
| `history`       | Archived chats and retained transcripts, for History and delete flows               |
| `context`       | A chat near a context threshold, so the Context Management tab has something to say |

**Orchestrations are deliberately excluded for now.** They are the largest surface and the least
settled; a playbook for them should wait until [agent-orchestration](../agent-orchestration/agent-orchestration.md)
has landed enough to be worth pinning.

### The Visualizer is the integration test

The visualizer is worth calling out separately: it renders sessions, subagents, token accounting,
personality colour, and workspace-relative paths, in a workspace pane and as a mini overlay. Getting
it to draw something correct means the daemon, the timeline, the accounting and the client all agree.
A `visualizer` playbook is therefore not one more feature check — it is the cheapest whole-system
check available. See [docs/visualizer.md](../../docs/visualizer.md).

## Stage 4 — the enumeration (charter)

The list above is what came to mind, which is not the same as what exists. The end state is a
**coverage matrix**: every user-facing Otto capability in one column, the playbook that reaches it in
another, and honest blanks where nothing does yet.

This has a precedent to follow rather than reinvent: `docs/testing.md` already carries the E2E
coverage matrix, and the rule that a spec is added to it in the same change. The playbook matrix
should work the same way and live beside it — and the two should converge, because a playbook that
reaches a state and an E2E spec that asserts about it want the same fixtures.

## Open questions

- Which stacks are worth a template on a machine that cannot build them? Go, Rust, PHP and Ruby have
  no toolchain here, so their templates would be highlighting-and-diff fixtures only. That is genuinely
  useful, but it makes "the boilerplate builds" a per-template property rather than a rule, and the
  set of always-skipped templates will only grow. Revisit once the buildable stacks are done.
- Does the coverage matrix live in `docs/testing.md` or beside it? Sharing one corpus argues for one
  matrix. Deciding early avoids the second registry problem that
  [the ledger rules](../README.md#the-rules) exist to prevent.
