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

Writing all tests first then all implementation produces bad tests — you end up testing imagined behavior instead of actual behavior.

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

## Test organization

- Collocate tests with implementation: `thing.ts` + `thing.test.ts`
- Extract complex setup into reusable helpers
- Test bodies should read like plain English
- Build a vocabulary of test helpers that make complex flows simple

### File naming

Vitest picks up tests by suffix. The suffix tells the runner which category it belongs to.

| Suffix                | What it is                                                                                                    | Where it runs                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `*.test.ts(x)`        | Unit test — pure, fast, no daemon                                                                             | `npm run test:unit`                                                                  |
| `*.posix.test.ts`     | Unit test that needs POSIX-only behavior                                                                      | unit, skipped on Windows                                                             |
| `*.browser.test.ts`   | App test that needs a real browser (DOM)                                                                      | `npm run test:browser` (Vitest browser mode, Playwright provider, headless Chromium) |
| `*.e2e.test.ts`       | End-to-end against a real daemon                                                                              | `npm run test:e2e`                                                                   |
| `*.real.e2e.test.ts`  | E2E that hits a real provider (Claude/Codex/Copilot/OpenCode/Pi) — needs creds in `packages/server/.env.test` | `npm run test:integration:real` / `test:e2e:real`                                    |
| `*.local.e2e.test.ts` | E2E that needs a local-only resource                                                                          | `npm run test:integration:local` / `test:e2e:local`                                  |

App-level Playwright browser E2E lives in `packages/app/e2e/*.spec.ts` and is a separate runner from Vitest E2E; it has three tiers of its own — see [App end-to-end tiers](#app-end-to-end-tiers-playwright) below.

Live provider smoke tests belong in `*.real.e2e.test.ts`, not `*.test.ts`, even when guarded by environment variables. Default unit suites must use deterministic provider adapters/fakes so missing credits, auth outages, and upstream model drift do not block normal CI.

Codex MultiAgentV2 real tests use local Codex authentication rather than the OpenRouter-compatible test provider. OpenRouter does not accept Codex collaboration-history items on the parent follow-up request, so it cannot verify a complete native sub-agent turn.

### Test setup

- Server: `packages/server/src/test-utils/vitest-setup.ts` loads `.env.test`, sets `OTTO_SUPERVISED=0`, and disables Git/SSH prompts. Add new global env shims here, not in individual tests.
- App: `packages/app/vitest.setup.ts` provides `expo`/`__DEV__` shims and stubs a few native-only modules (`react-native-unistyles`, `react-native-svg`, `expo-linking`, `@xterm/addon-ligatures`). Stubbing here is for modules that have no meaningful Node behavior — not a license to mock app code.

## App end-to-end tiers (Playwright)

The app's browser E2E suite in `packages/app/e2e/` runs a fully isolated stack per run —
`global-setup.ts` forks a throwaway `OTTO_HOME` with its own daemon, relay and Metro on dynamic
ports, so a run never touches the real `~/.otto` or the port-6868 daemon — `6788`, the repo dev
daemon, is reserved against too, so e2e and dev can run side by side. Specs are split into
three tiers by suffix, and the tier is selected by **Playwright project**, never by a conditional
skip inside a spec:

| Tier                 | Suffix            | What it proves                                                                                                                                             | Cost             | When it runs                         |
| -------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------ |
| **T1 Mock**          | `*.spec.ts`       | UI and daemon behaviour against the deterministic mock agent (`helpers/mock-agent.ts`). The bulk of coverage.                                              | Free             | Every category run; CI shards        |
| **T2 Local-AI**      | `*.local.spec.ts` | The **full live agent loop** — prompt → tool calls → file edits → diff and UI updates — via the openai-compat provider pointed at a local LM Studio model. | Free (local GPU) | Release validation; opt-in locally   |
| **T3 Real provider** | `*.real.spec.ts`  | Provider-specific integration (Claude/Codex/OpenCode/Pi rewind, session import).                                                                           | Paid             | Release validation only, minimal set |

The default project ignores the `*.local.spec.ts` and `*.real.spec.ts` suffixes, so CI needs no
credentials.

**Why T2 exists.** The mock agent proves the UI and daemon plumbing but scripts every agent event,
so it can never prove the loop itself: that a prompt actually becomes tool calls, that tool results
feed back correctly, that compaction leaves a usable session, that a permission denial actually
stops the tool. T3 proves that and costs money per run. A local model is the missing middle — and
for the openai-compat provider specifically it _is_ the production code path, not a stand-in.

Connection values (`E2E_LOCAL_AI_BASE_URL` / `_API_KEY` / `_MODEL`) live in the gitignored repo-root
`.env.test` and are **never** hardcoded in a spec. With `E2E_LOCAL_AI=1` global setup injects the
provider block into the forked `OTTO_HOME` and preflights `GET {baseUrl}/models` to assert the
pinned model is loaded — which catches "LM Studio not running" in seconds instead of a 60 s spec
timeout, and warms the JIT-loaded model at the same time. Pin one quant; never track "latest".

### Writing T2/T3 specs that do not flake

**Assert on side effects, not on model prose.** A live-model spec asks the agent to do something
with an unambiguous observable outcome and asserts the outcome appears in the UI or on disk. Never
assert on the assistant's wording.

- **One imperative, one observable side effect.** "Create a file named `EXACTLY.txt` containing
  exactly `hello-e2e` and nothing else. Do not explain." Then assert the file row appears in
  Changes and the content matches through the daemon.
- **Cap the blast radius** — a low tool-round cap for the spec's agent, a temp workspace, and
  60–120 s timeouts, because local inference is slow.
- **Assert loop mechanics, not intelligence.** Good targets: a tool call row rendered, a permission
  prompt appeared and denial stopped execution, a compaction event emitted and the session still
  answers, rewind truncated the timeline. Bad targets: summary quality, wording, multi-file
  refactors.
- **Retries are legitimate here, and only here.** Inference is nondeterministic, so one retry on
  the local-AI project is honest; T1 keeps zero.

### Coverage matrix and run reports

`projects/e2e-qa-coverage/coverage-matrix.md` is the single source of truth for what is covered:
one section per feature category, one row per behaviour, marked ✅ / 🟡 / ❌ with the covering spec
files named inline. **It is live tooling, not a plan** — two things read it at runtime:

- `npm run e2e:coverage` (`scripts/e2e-coverage-check.mjs`) fails on a **stale row** (the matrix
  names a spec that no longer exists) or an **unmapped spec** (a spec on disk no row claims), and
  prints a per-category scoreboard. Pure file analysis, no daemon, under a second. **CI runs it in
  the `lint` job**, before `npm ci`, on every push and pull request — it rode nobody's habit for one
  release cycle and drifted, which is how `client-resource-soak.spec.ts` reached `main` unmapped.
  It is deliberately _not_ a pre-commit hook step: the hook is shared by every parallel session in a
  working tree, and this check must compare the whole spec directory against the whole matrix, so it
  cannot be scoped to staged files.
- The QA reporter (`packages/app/e2e/reporters/qa-reporter.ts`) reads the matrix's sections to
  bucket every test under its module, so the plan and the run artifacts stay in lockstep. **A spec
  showing up as "Unclassified" in a report means the matrix drifted** — fix the matrix, not the
  reporter.

Adding a spec is three steps, and the checker enforces the middle one: write it importing
`test`/`expect` from `./fixtures` (never from `@playwright/test` — the auto fixture is what seeds
the daemon host, and without it the app sits on the pairing screen), add a matrix row at 🟡, and
call `moneyShot()` at the moment the behaviour is proven.

**A measurement harness is not coverage.** A spec whose only assertions are that the instrument
produced a usable series — the resource soak, the terminal perf runs — proves nothing about
product behaviour, so it belongs in the matrix's §16 marked 📊, which the scoreboard counts
separately and keeps out of the percentage. Filing one under a feature section as ✅ tells the next
reader that behaviour is tested when nothing asserted it, and does so in a section the release
runbook reads.

A run produces a report under `packages/app/e2e-report/` — a per-module table of contents, a
failure report, a flat greppable log, and per-test evidence directories — plus Playwright's own
HTML report. None of it is committed; it is regenerated from scratch each run so a stale money shot
can never be mistaken for proof. Both report roots are overridable (`E2E_REPORT_DIR`,
`E2E_HTML_REPORT_DIR`) so concurrent runs cannot overwrite each other mid-write.

**A passing test that leaves no visual trace is unauditable**, so every test ships one confirming
frame. `moneyShot(page, claim)` is _the_ frame, and `claim` is rendered as the caption in the
digest — write it as the assertion in plain English, not as a step name. `qaShot(page, label)` adds
intermediate frames that stay with the test's own evidence. Every passing test gets a money shot
whether or not it asks for one: an auto fixture captures the final frame of any test that never
called `moneyShot`, labelled `final frame (auto)`. That guarantees full digest coverage, but the
auto frame is captured at teardown — often after the interesting state is gone — so treat
`final frame (auto)` in a digest as a **TODO**, not as proof. Capture never fails a test; if the
page is already closed the screenshot is skipped silently.

### Regression specs

Every bug we fix should leave a test behind, and the test should say which bug it guards:

- **Name it after the behaviour, suffixed `-regression`** — `personality-autosubmit-regression.spec.ts`,
  not `bug-1234.spec.ts`. The suffix makes the regression set greppable; the behaviour name keeps it
  readable once the original bug is forgotten.
- **Head the spec with a docblock stating the bug, the symptom and the fix**, symptom first, so the
  next person knows what breaking this test actually means.
- **Assert the symptom, not the implementation.** The fix will be refactored; the symptom is what
  must never come back.
- **The matrix row goes in the module the bug lived in**, not a separate regressions section — a
  personality bug is personality coverage.
- **`moneyShot()` the frame showing the symptom is absent.** That frame is the durable record.

### Out of Playwright-web scope

Electron-only behaviour (GPU fallback relaunch, focus-mode caption strip, tray, native menus, real
desktop updates) cannot run in the web harness — those go to
[browser-capture-harness.md](browser-capture-harness.md) plus a manual checklist in the release
runbook. Native mobile flows belong to Maestro; see [mobile-testing.md](mobile-testing.md).

## Running tests locally

Test suites in this repo are heavy. Running them in bulk freezes the machine, especially with multiple agents in parallel.

- Run only the file you changed: `npx vitest run <path> --bail=1`
- Never run `npm run test` for a whole workspace unless asked.
- For a broad sweep, redirect to a file and read it after: `npx vitest run <path> --bail=1 > /tmp/test-output.txt 2>&1`
- Never re-run a suite another agent already reported green.
- For full-suite confidence, push to CI and check GitHub Actions.
- Never run the full Playwright E2E suite locally — defer whole-suite verification to CI. Targeted Playwright specs are allowed when you changed or need to prove that specific flow.
- App Playwright specs share one isolated daemon per run. Helpers that create projects or workspaces must remove the daemon project record during cleanup, not only delete the temp directory. Agent helpers must pass the intended `workspaceId` through to agent creation; never infer ownership from `cwd`.
- CI can shard app Playwright across multiple jobs; each shard still owns a full isolated daemon/relay/Metro stack from global setup. Helpers that restart the daemon must preserve the global setup environment, including disabled speech/local-model settings, so a restart does not change the tested surface or start background downloads.

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

1. **Unit tests with ports and adapters** — production code receives its real-world dependencies (DB, HTTP, CLI process, clock, randomness, filesystem, other modules) through an injected interface. Tests wire a typed in-memory fake colocated with the production module. **No `vi.mock`, `vi.hoisted`, `vi.spyOn` of own exports, JSDOM, `@testing-library` component mounting, RN test renderer, monkey-patched globals, or fake-server fixtures.** If a test needs any of those, the production module is missing a port — fix the seam, then write the test against a fake adapter.
2. **Real end-to-end tests** — real daemon, real network, real browser (Playwright for app code) or a real isolated server instance (for daemon code). No JSDOM, no mocked transport.

Anything in between — component tests in JSDOM, vitest tests that mock the module under test, tests that assert on private state — is slop on its way out.
