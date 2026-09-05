# Testing

## Philosophy

Tests prove behavior, not structure. Every test should answer: "what user-visible or API-visible behavior does this verify?"

## Test-driven development

Work in vertical slices: one test, one implementation, repeat. Each test responds to what you learned from the previous cycle.

```
RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3

WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5
```

Writing all tests first then all implementation produces bad tests - you end up testing imagined behavior instead of actual behavior.

## Fallible user actions

Every user action that can fail must expose the complete operation state in the UI:

- **Pending:** show immediate progress and prevent accidental duplicate submissions.
- **Success:** show the requested result, or a clear success acknowledgement when the result is not otherwise visible.
- **Failure:** keep an actionable error visible in the same context until the user retries or dismisses it.

Logs, console output, and a reset button are not user feedback. Neither is a platform API unless it is verified on every supported platform: React Native Web's `Alert.alert()` is a no-op, so browser and Electron failures must use rendered app UI such as the shared alert component.

Every fallible action needs behavioral coverage for success and failure. RPC-backed UI should use an app Playwright test with a real browser, network, and daemon whenever feasible. The failure test must assert what the user can see and do after the failure, not an internal response, state field, or log line. Add distinct timeout or disconnect cases when they produce distinct recovery behavior.

## Determinism first

Tests must produce the same result every run:

- No conditional assertions or branching paths
- No reliance on timing, randomness, or network jitter
- No weak assertions (`toBeTruthy`, `toBeDefined`)
- Assert the full intended behavior, not fragments

```typescript
// Bad: conditional and weak
it("creates a tool call", async () => {
  const result = await createToolCall(input);
  if (result.ok) {
    expect(result.id).toBeDefined();
  }
});

// Good: deterministic and explicit
it("returns timeout error when provider times out", async () => {
  const result = await createToolCall(input);
  expect(result).toEqual({
    ok: false,
    error: { code: "PROVIDER_TIMEOUT", waitedMs: 30000 },
  });
});
```

## Flaky tests are a bug

Never remove a test because it's flaky. Find the variance source (time, randomness, race condition, shared state, non-deterministic output, environment drift) and fix it.

## Real dependencies over mocks

Mocks are not the default. They require an explicit decision.

- **Database**: real test database, not a mock
- **APIs**: real APIs with test/sandbox credentials, not request mocks
- **File system**: temporary directory that gets cleaned up, not fs mocks

Ask: "will this still hold with real dependencies at runtime?" If no, don't mock.

### Use swappable adapters instead

When you need test isolation, design code so dependencies are injectable:

```typescript
interface EmailSender {
  send(to: string, body: string): Promise<void>;
}

// Production
const realSender: EmailSender = { send: sendgrid.send };

// Test: in-memory adapter
function createTestEmailSender() {
  const sent: Array<{ to: string; body: string }> = [];
  return {
    send: async (to: string, body: string) => {
      sent.push({ to, body });
    },
    sent,
  };
}
```

## End-to-end means end-to-end

When a test is labeled end-to-end, it calls the real service. No environment variable gates, no conditional skipping, no mocking the external dependency.

### Packaged desktop smoke

The packaged desktop smoke is an external observer of the production launch path. It must not add a smoke-only branch to Electron main or start the daemon itself.

The harness launches the unpacked packaged app with isolated user data and daemon state, connects to the real renderer over Chromium's debugging protocol, and requires all of these outcomes:

- the `otto://app/` renderer mounts into `#root`;
- the sandboxed preload exposes the desktop bridge;
- `webContents.printToPDF` returns real PDF bytes through that bridge (the markdown PDF export has
  no headless stand-in, so this is the only tier that can prove it);
- the renderer starts a fresh desktop-managed daemon through the normal startup bootstrap;
- the bundled CLI can query that daemon and run a terminal command.

Pull-request CI runs the Linux x64 smoke under Xvfb when the cumulative PR diff changes `packages/desktop/**`. The desktop release matrix runs the harness against each host-native packaged app before publishing. All smoke jobs upload renderer, desktop, and daemon diagnostics on failure.

To exercise the smoke locally on Linux:

```bash
OTTO_DESKTOP_SMOKE=1 \
OTTO_DESKTOP_SMOKE_ARTIFACT_DIR=/tmp/otto-desktop-smoke \
npm run build:desktop -- --publish never --linux --x64 --dir
```

### Undeclared peer dependencies break app.asar

electron-builder packs `node_modules` by walking declared production `dependencies`. A package that imports something it only lists as a `peerDependency` resolves fine in this hoisted workspace, passes every test, and then throws `ERR_MODULE_NOT_FOUND` inside `app.asar` — killing the desktop daemon at startup. That shipped twice from `@replit/codemirror-lang-*` grammars, which are interactive editor extensions published as if they were bare parsers.

The packaged smoke catches it but only runs when a PR touches the `desktop` filter in `.github/ci-paths.yml`. Both offenders landed under `packages/highlight/**`, which maps to `sdk`.

`packages/highlight/src/__tests__/dependency-closure.test.ts` replicates the packer's traversal statically and runs with the normal unit tests. It is scoped to `@otto-code/highlight` on purpose: that tree is small and pure, so the check is exact. Running the same walk over `@otto-code/server` produces dozens of false positives from optional dependencies loaded behind `try`/`catch`.

Prefer a `@lezer/*` grammar. When a language only ships inside an editor extension, vendor the grammar into `packages/highlight/src/<lang>/` — see `svelte/`, `nix/`, and `csharp/`.

### Desktop browser regression

The desktop browser E2E launches an isolated real daemon, Metro, and Electron app. It forces workspace LRU eviction to reparent the original tab and replace its guest `WebContents`, then makes one MCP call each for tab listing, snapshot, and click against that original browser id. A final MCP wait proves the real target page received the click.

Run it locally with the same command owned by the Ubuntu `desktop-tests` required check:

```bash
npm run test:e2e:browser-tabs --workspace=@otto-code/desktop
```

### Desktop skill selection upgrade regression

After `npm run build:server`, run
`npm run test:e2e:skill-selection-upgrade --workspace=@otto-code/desktop`.
The default `attached` case launches a real managed daemon before Electron and checks
that a partial installation stays partial while a real legacy-file read error prevents
import. Repairing that file must trigger the mounted migration's retry, durable import,
source removal, and selected-only maintenance. Set `OTTO_SKILL_UPGRADE_MODE=cold` to
exercise daemon launch through the normal renderer startup IPC. Both cases reload the
renderer and verify the persisted selection and daemon identity.

| Behavior                                                                                                                                                   | Covering harness                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Local desktop skill selection survives cold startup, managed-daemon attachment, read failure/retry, and renderer reload without installing excluded skills | `packages/desktop/scripts/skill-selection-upgrade.e2e.mjs` |

The harness isolates OS `HOME`/`USERPROFILE`, Electron user data, daemon home, and
ephemeral ports under repository `.tmp/agent-02/`. Provider catalogs are disabled through
persisted configuration. It uses the registered Electron IPC handlers and the real
WebSocket import path. Logs, a screenshot, and result JSON remain as evidence; successful
runtime fixtures are removed after owned processes stop, while failed fixtures remain
for inspection.

## Test organization

- Collocate tests with implementation: `thing.ts` + `thing.test.ts`
- Extract complex setup into reusable helpers
- Test bodies should read like plain English
- Build a vocabulary of test helpers that make complex flows simple

### File naming

Vitest picks up tests by suffix. The suffix tells the runner which category it belongs to.

| Suffix                | What it is                                                                                                    | Where it runs                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `*.test.ts(x)`        | Unit test - pure, fast, no daemon                                                                             | `npm run test:unit`                                                                  |
| `*.posix.test.ts`     | Unit test that needs POSIX-only behavior                                                                      | unit, skipped on Windows                                                             |
| `*.browser.test.ts`   | App test that needs a real browser (DOM)                                                                      | `npm run test:browser` (Vitest browser mode, Playwright provider, headless Chromium) |
| `*.e2e.test.ts`       | End-to-end against a real daemon                                                                              | `npm run test:e2e`                                                                   |
| `*.real.e2e.test.ts`  | E2E that hits a real provider (Claude/Codex/Copilot/OpenCode/Pi) - needs creds in `packages/server/.env.test` | `npm run test:integration:real` / `test:e2e:real`                                    |
| `*.local.e2e.test.ts` | E2E that needs a local-only resource                                                                          | `npm run test:integration:local` / `test:e2e:local`                                  |

Browser Playwright specs live in `packages/app/e2e/browser/`. Desktop Playwright and real-Electron E2E live in `packages/desktop/e2e/`. Harness code shared by both suites lives in `packages/app/e2e/support/`; neither suite may place specs there. App Playwright specs that hit real providers use `*.real.spec.ts` and run through `npm run test:e2e:real --workspace=@otto-code/app`; the default browser project ignores that suffix so CI does not need provider credentials. It has three tiers of its own, see [App end-to-end tiers](#app-end-to-end-tiers-playwright) below.

Live provider smoke tests belong in `*.real.e2e.test.ts`, not `*.test.ts`, even when guarded by environment variables. Default unit suites must use deterministic provider adapters/fakes so missing credits, auth outages, and upstream model drift do not block normal CI.

Codex MultiAgentV2 real tests use local Codex authentication rather than the OpenRouter-compatible test provider. OpenRouter does not accept Codex collaboration-history items on the parent follow-up request, so it cannot verify a complete native sub-agent turn.

### Test setup

- Server: `packages/server/src/test-utils/vitest-setup.ts` loads `.env.test`, sets `OTTO_SUPERVISED=0`, and disables Git/SSH prompts. Add new global env shims here, not in individual tests.
- App: `packages/app/vitest.setup.ts` provides `expo`/`__DEV__` shims and stubs a few native-only modules (`react-native-unistyles`, `react-native-svg`, `expo-linking`, `@xterm/addon-ligatures`). Stubbing here is for modules that have no meaningful Node behavior - not a license to mock app code.

## One browser, and which one

Otto ships inside Electron, so in production the app renders in **Electron's bundled Chromium** and
the browser pane is a `<webview>` on that same engine. Automated tests do not drive that engine.
Everything that needs a real browser drives **Playwright's bundled Chromium**, on every platform,
in CI and locally alike.

Those are two different Chromium builds, and keeping them different is deliberate. Playwright's
build is pinned, downloadable, identical on Windows, macOS and Linux, and is what CI runs; chasing
Electron's exact Chromium would mean booting Electron for tests that only need a DOM, which is
slower, and platform-specific in a way that turns one failing assertion into three per-OS
investigations. Where Electron genuinely _is_ the thing under test, a harness drives Electron
directly: the packaged desktop smoke and the browser tab bridge E2E both do, and those are the
right places for engine-specific behaviour to be proven.

**The pin is the `playwright` version in the root `package.json`, and nothing else.** Never pin a
Chromium revision by hand, and never point a config at an explicit `executablePath`. A revision
written down anywhere other than that dependency is a second source of truth that will drift.

Two tiers need the browser present:

| Tier                | Command                | What it launches                                      |
| ------------------- | ---------------------- | ----------------------------------------------------- |
| `*.browser.test.ts` | `npm run test:browser` | Vitest browser mode, headless, the **headless shell** |
| `packages/app/e2e/` | `npm run e2e`          | Playwright, `Desktop Chrome`, the **full chromium**   |

`npm run browsers:install` fetches both into the checkout-local
`.tmp/otto-playwright-browsers/` cache, and both `test:browser` and `test:e2e` run it as a pre-hook.
The cache is deliberately not Playwright's user-global cache: unrelated repositories must never
block Otto on a shared `__dirlock`. Otto's installer serializes concurrent installs for this
checkout, rechecks the pinned browser after it acquires the lock, and reclaims only an Otto lock
whose owning process is gone. When the browser is already present the hook costs about a second
and touches no network.

### When it still goes wrong

The failure reads `Executable doesn't exist at ...chromium_headless_shell-<rev>`, and it is almost
always **a missing install, not a version mismatch**. Two things make it look like a mismatch:

- **Headless and headed are separate downloads.** Having `chromium-<rev>` is not enough for
  `test:browser`, which launches the headless shell. `playwright install chromium` lands both.
- **The browser cache is checkout-local.** Otto's official browser-test scripts set
  `PLAYWRIGHT_BROWSERS_PATH` to `.tmp/otto-playwright-browsers/`, so another repository's Playwright
  install cannot block or satisfy this checkout. Do not call bare `npx playwright` for an Otto
  test: use the npm scripts, which set the cache before Playwright loads. An explicit
  `PLAYWRIGHT_BROWSERS_PATH` remains an intentional override for specialized environments.

`E2E_BROWSER_CHANNEL=msedge` drives an installed Edge instead of the downloaded Chromium. It is an
escape hatch for a machine that cannot download browsers, and it tests Edge rather than the browser
CI runs, so it must never be the default or appear in CI. The one standing exception is the demo
capture pipeline, which sets it automatically on Windows; see
[site-demos.md](site-demos.md).

## App end-to-end tiers (Playwright)

The app's browser E2E suite in `packages/app/e2e/` runs a fully isolated stack per run -
`global-setup.ts` forks a throwaway `OTTO_HOME` with its own daemon, relay and Metro on dynamic
ports, so a run never touches the real `~/.otto` or the port-6868 daemon - `6788`, the repo dev
daemon, is reserved against too, so e2e and dev can run side by side. Specs are split into
three tiers by suffix, and the tier is selected by **Playwright project**, never by a conditional
skip inside a spec:

| Tier                 | Suffix            | What it proves                                                                                                                                             | Cost             | When it runs                         |
| -------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------ |
| **T1 Mock**          | `*.spec.ts`       | UI and daemon behaviour against the deterministic mock agent (`helpers/mock-agent.ts`). The bulk of coverage.                                              | Free             | Every category run; CI shards        |
| **T2 Local-AI**      | `*.local.spec.ts` | The **full live agent loop** - prompt → tool calls → file edits → diff and UI updates - via the openai-compat provider pointed at a local LM Studio model. | Free (local GPU) | Release validation; opt-in locally   |
| **T3 Real provider** | `*.real.spec.ts`  | Provider-specific integration (Claude/Codex/OpenCode/Pi rewind, session import).                                                                           | Paid             | Release validation only, minimal set |

The default project ignores the `*.local.spec.ts` and `*.real.spec.ts` suffixes, so CI needs no
credentials.

**The E2E host starts with an empty personality roster.** A fresh `OTTO_HOME` is seeded with the
shipped starter team, and every apply-now form surface then auto-binds its role's first available
personality: the ladder in `useFormRolePersonality` puts a team or personality above the device's
last-used model on purpose. Those builtins are all Claude-bound, so on the E2E host the composer,
the schedule form and the daemon's Writer-role mini-tasks (chat auto-title) would all leave the
deterministic mock provider behind and land on one with no credentials. `global-setup.ts` therefore
writes empty `agentPersonalities` / `agentTeams` sections into the forked config before the daemon
boots, which is the same "user cleared the roster" state the daemon honours instead of re-seeding.
Specs that exercise personalities or teams seed their own through `helpers/personalities.ts`, so if
a spec needs one, seed it; never assume a builtin is there.

**Why T2 exists.** The mock agent proves the UI and daemon plumbing but scripts every agent event,
so it can never prove the loop itself: that a prompt actually becomes tool calls, that tool results
feed back correctly, that compaction leaves a usable session, that a permission denial actually
stops the tool. T3 proves that and costs money per run. A local model is the missing middle - and
for the openai-compat provider specifically it _is_ the production code path, not a stand-in.

Connection values (`E2E_LOCAL_AI_BASE_URL` / `_API_KEY` / `_MODEL`) live in the gitignored repo-root
`.env.test` and are **never** hardcoded in a spec. With `E2E_LOCAL_AI=1` global setup injects the
provider block into the forked `OTTO_HOME` and preflights `GET {baseUrl}/models` to assert the
pinned model is loaded - which catches "LM Studio not running" in seconds instead of a 60 s spec
timeout, and warms the JIT-loaded model at the same time. Pin one quant; never track "latest".

### Writing T2/T3 specs that do not flake

**Assert on side effects, not on model prose.** A live-model spec asks the agent to do something
with an unambiguous observable outcome and asserts the outcome appears in the UI or on disk. Never
assert on the assistant's wording.

- **One imperative, one observable side effect.** "Create a file named `EXACTLY.txt` containing
  exactly `hello-e2e` and nothing else. Do not explain." Then assert the file row appears in
  Changes and the content matches through the daemon.
- **Cap the blast radius** - a low tool-round cap for the spec's agent, a temp workspace, and
  60 to 120 s timeouts, because local inference is slow.
- **Assert loop mechanics, not intelligence.** Good targets: a tool call row rendered, a permission
  prompt appeared and denial stopped execution, a compaction event emitted and the session still
  answers, rewind truncated the timeline. Bad targets: summary quality, wording, multi-file
  refactors.
- **Retries are legitimate here, and only here.** Inference is nondeterministic, so one retry on
  the local-AI project is honest; T1 keeps zero.

### Coverage matrix and run reports

`projects/e2e-qa-coverage/coverage-matrix.md` is the single source of truth for what is covered:
one section per feature category, one row per behaviour, marked ✅ / 🟡 / ❌ with the covering spec
files named inline. **It is live tooling, not a plan** - two things read it at runtime:

- `npm run e2e:coverage` (`scripts/e2e-coverage-check.mjs`) fails on a **stale row** (the matrix
  names a spec that no longer exists) or an **unmapped spec** (a spec on disk no row claims), and
  prints a per-category scoreboard. Pure file analysis, no daemon, under a second. **CI runs it in
  the `lint` job**, before `npm ci`, on every push and pull request - it rode nobody's habit for one
  release cycle and drifted, which is how `client-resource-soak.spec.ts` reached `main` unmapped.
  It is deliberately _not_ a pre-commit hook step: the hook is shared by every parallel session in a
  working tree, and this check must compare the whole spec directory against the whole matrix, so it
  cannot be scoped to staged files.
- The QA reporter (`packages/app/e2e/reporters/qa-reporter.ts`) reads the matrix's sections to
  bucket every test under its module, so the plan and the run artifacts stay in lockstep. **A spec
  showing up as "Unclassified" in a report means the matrix drifted** - fix the matrix, not the
  reporter.

Adding a spec is three steps, and the checker enforces the middle one: write it importing
`test`/`expect` from `./fixtures` (never from `@playwright/test` - the auto fixture is what seeds
the daemon host, and without it the app sits on the pairing screen), add a matrix row at 🟡, and
call `moneyShot()` at the moment the behaviour is proven.

**A measurement harness is not coverage.** A spec whose only assertions are that the instrument
produced a usable series - the resource soak, the terminal perf runs - proves nothing about
product behaviour, so it belongs in the matrix's §16 marked 📊, which the scoreboard counts
separately and keeps out of the percentage. Filing one under a feature section as ✅ tells the next
reader that behaviour is tested when nothing asserted it, and does so in a section the release
runbook reads.

A run produces a report under `packages/app/e2e-report/` - a per-module table of contents, a
failure report, a flat greppable log, and per-test evidence directories - plus Playwright's own
HTML report. None of it is committed; it is regenerated from scratch each run so a stale money shot
can never be mistaken for proof. Both report roots are overridable (`E2E_REPORT_DIR`,
`E2E_HTML_REPORT_DIR`) so concurrent runs cannot overwrite each other mid-write.

**A passing test that leaves no visual trace is unauditable**, so every test ships one confirming
frame. `moneyShot(page, claim)` is _the_ frame, and `claim` is rendered as the caption in the
digest - write it as the assertion in plain English, not as a step name. `qaShot(page, label)` adds
intermediate frames that stay with the test's own evidence. Every passing test gets a money shot
whether or not it asks for one: an auto fixture captures the final frame of any test that never
called `moneyShot`, labelled `final frame (auto)`. That guarantees full digest coverage, but the
auto frame is captured at teardown - often after the interesting state is gone - so treat
`final frame (auto)` in a digest as a **TODO**, not as proof. Capture never fails a test; if the
page is already closed the screenshot is skipped silently.

### Regression specs

Every bug we fix should leave a test behind, and the test should say which bug it guards:

- **Name it after the behaviour, suffixed `-regression`** - `personality-autosubmit-regression.spec.ts`,
  not `bug-1234.spec.ts`. The suffix makes the regression set greppable; the behaviour name keeps it
  readable once the original bug is forgotten.
- **Head the spec with a docblock stating the bug, the symptom and the fix**, symptom first, so the
  next person knows what breaking this test actually means.
- **Assert the symptom, not the implementation.** The fix will be refactored; the symptom is what
  must never come back.
- **The matrix row goes in the module the bug lived in**, not a separate regressions section - a
  personality bug is personality coverage.
- **`moneyShot()` the frame showing the symptom is absent.** That frame is the durable record.

### Out of Playwright-web scope

Electron-only behaviour (GPU fallback relaunch, focus-mode caption strip, tray, native menus, real
desktop updates) cannot run in the web harness - those go to
[browser-capture-harness.md](browser-capture-harness.md) plus a manual checklist in the release
runbook. Native mobile flows belong to Maestro; see [mobile-testing.md](mobile-testing.md).

## Running tests locally

Test suites in this repo are heavy. Running them in bulk freezes the machine, especially with multiple agents in parallel.

- Run only the file you changed: `npx vitest run <path> --bail=1`
- Never run `npm run test` for a whole workspace unless asked.
- For a broad sweep, redirect to a file and read it after: `npx vitest run <path> --bail=1 > /tmp/test-output.txt 2>&1`
- Never re-run a suite another agent already reported green.
- For full-suite confidence, push to CI and check GitHub Actions.
- Never run the full Playwright E2E suite locally; defer whole-suite verification to CI. Targeted Playwright specs are allowed when you changed or need to prove that specific flow.
- App Playwright shares one warmed Metro server per run and gives every Playwright worker its own isolated daemon and `OTTO_HOME`. Spec files run concurrently without exposing one file's projects, agents, terminals, history, or provider configuration to another worker; tests within a file remain together so file-level setup is not repeated.
- Never run the full Playwright E2E suite locally — defer whole-suite verification to CI. Targeted Playwright specs are allowed when you changed or need to prove that specific flow.
- App Playwright shares one warmed Metro server per run and gives every Playwright worker its own isolated daemon and `OTTO_HOME`. Spec files run concurrently without exposing one file's projects, agents, terminals, history, or provider configuration to another worker; tests within a file remain together so file-level setup is not repeated.
- Playwright specs that exercise only the daemon import `daemonTest` from the shared fixtures so they do not create a browser context or page.
- Helpers that create projects or workspaces own those records until cleanup. Their clients remove the daemon project on close, and an automatic fixture fails any test that still leaks a project record. Deleting only the temporary directory is not cleanup. Agent helpers pass the intended `workspaceId` through to agent creation; they never infer ownership from `cwd`.
- Tests whose subject is daemon-global state, such as an empty history or daemon restart, start a dedicated host explicitly. Filenames and directories describe product behavior, never execution order or isolation mechanics.
- Global setup accepts Metro as ready only when `/status` returns `packager-status:running`, then fetches the document's scripts so the cold bundle compilation finishes before Playwright's per-test timeout starts. A generic TCP listener is not sufficient readiness evidence. The browser suite uses direct local daemon connections and does not start a relay.
- The app Playwright harness boots on Windows as well as POSIX. Spawn Node entrypoints through `process.execPath`, not `npx` or `node_modules/.bin` shims: Node refuses to spawn `.cmd` or `.bat` without `shell: true`, and shell mode concatenates argv without escaping and sends kill signals to `cmd.exe` instead of the real child.
- Teardown kills the process tree, because a Windows signal reaches only the direct child and leaves forked workers holding the listening port.
- The `asdf`-backed local Elixir relay stays POSIX-only, so the `relay-deployment` Playwright project is unavailable on Windows.

## Pull-request test routing

**Every job runs on every push right now, and that is deliberate.** Path routing was removed on
2026-08-18 after it produced green runs that had executed nothing: the skip was wired as a per-step
`if:` guard, so an unaffected job ran a single `echo` and reported **success**. Between 2026-08-07
and 2026-08-18 that gave 80 consecutive runs, 55 failures, 22 cancellations, and 3 "successes" that
had all skipped Playwright entirely. A continuously red suite was indistinguishable from a healthy
one, and 0.8.10 shipped on a cancelled run.

The invariant that has to hold before routing comes back: **the condition goes on the job, never on
its steps.** A routed-out job must report `skipped`, never `success`. Matrix legs have to expand into
statically named jobs first, or the required-check name moves when the matrix does.

`.github/ci-paths.yml` is the filter definition prepared for that return, and
`scripts/ci-workflow.test.mjs` is the contract test that would enforce the job names. Neither is
wired into `.github/workflows/ci.yml` yet, so treat them as staged work rather than current
behavior. When routing is reinstated, the smallest meaningful contract wins over package ownership:
a package does not inherit every suite of its runtime consumers, cross-package static compatibility
belongs to `typecheck`, and repository scripts plus the shared Vitest configuration run every
contract because they are cross-cutting toolchain inputs.

### Structural diff corpus

`npm run test:structural-diff` is the structural-diff inner loop. It reads
version-pinned source pairs from
`packages/app/src/utils/__fixtures__/structural-diff/` and evaluates only pure
diff functions. It never starts Electron, the daemon, a browser, or the
Difftastic executable.

Copied Difftastic cases retain their source, commit pin, and license notice in
that directory. Each case asserts review semantics rather than terminal output:
shared context, replacements, pure additions and removals, exact moves, and
formatting-only changes. The corpus also asserts parser-safe fallback for
malformed complete sources. Structural eligibility is derived directly from
the syntax parser registry, and its unit test prevents a supported language
from silently falling out of the Structural pipeline. Add a fixture only with
the smallest expectation that captures the reviewer-visible behavior being
changed. A separate visual regression gate is responsible for renderer
snapshots; do not turn this fast corpus into a screenshot suite.

## Agent authentication in tests

Agent providers handle their own auth. Do not add auth checks, environment variable gates, or conditional skips to tests. If auth fails, report it.

## Debugging with tests

Use the test as your debugging ground:

1. Add temporary logging to the code under test
2. Run the test, observe actual values
3. Trace the flow end-to-end through test output
4. Confirm each assumption with actual output
5. Remove logging when done

The test output is the source of truth, not your reading of the code.

## Design for testability

If code isn't testable, refactor it. Signs:

- You want to reach for a mock
- You can't inject a dependency
- You need to test private internals
- Setup requires too much global state

Aim for deep modules: small interface, deep implementation. Fewer methods = fewer tests needed, simpler params = simpler setup.

## Two test categories, no others

Every test in this repo lives in exactly one of these shapes:

1. **Unit tests with ports and adapters** - production code receives its real-world dependencies (DB, HTTP, CLI process, clock, randomness, filesystem, other modules) through an injected interface. Tests wire a typed in-memory fake colocated with the production module. **No `vi.mock`, `vi.hoisted`, `vi.spyOn` of own exports, JSDOM, `@testing-library` component mounting, RN test renderer, monkey-patched globals, or fake-server fixtures.** If a test needs any of those, the production module is missing a port - fix the seam, then write the test against a fake adapter.
2. **Real end-to-end tests** - real daemon, real network, real browser (Playwright for app code) or a real isolated server instance (for daemon code). No JSDOM, no mocked transport.

Anything in between - component tests in JSDOM, vitest tests that mock the module under test, tests that assert on private state - is slop on its way out.
