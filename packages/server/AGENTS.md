# AGENTS.md - Otto Server Development Guide

For AI coding agents working in `packages/server`. Supplements at the repo root.

## Build / Lint / Test Commands

Script names live in the root and package `package.json`. **Read the root AGENTS.md rule on test suites before running any of them: never run a full suite locally, and never `npm run test` for a whole workspace unless explicitly asked.** The invocations that are not guessable from a script name:

```bash
# Run a SINGLE test file
npx vitest run src/server/agent/agent-manager.test.ts --reporter=verbose

# Run a SINGLE test by name
npx vitest run -t "returns timeout error when provider times out"

npm run db:query -- "SELECT ..."             # Run arbitrary SQL
npm run cli -- ls -a -g                      # List agents
npm run cli -- daemon status                 # Check daemon status
```

---

## Code Style

Formatting is oxfmt, linting is oxlint; both read config from the repo root. Do not hand-fix formatting.

### TypeScript

- **Fully strict** - no `any`, no implicit `any`
- **`interface`** over `type`\*\* when possible
- **`function` declarations** over arrow function assignments
- **Named types** - no complex inline types in public signatures
- **Object parameters** - use single object param when >1 argument
- **Infer from Zod schemas** - `z.infer<typeof schema>` instead of hand-written types
- `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`

### Imports

- Use path alias `@server/*` in server package (maps to `./src/`)
- No barrel `index.ts` re-exports - they create unnecessary indirection

### Naming

- Files: `kebab-case.ts` named after the main export (`create-tool-call.ts`)
- Tests: collocated with implementation (`thing.test.ts`)
- No prefixes like `RpcX`, `DbX`, `UiX` - keep one canonical type per concept

### Error Handling

- **Fail explicitly** - throw instead of silently returning defaults
- **Typed domain errors** - extend `Error` with structured metadata

```typescript
class TimeoutError extends Error {
  constructor(
    public readonly operation: string,
    public readonly waitedMs: number,
  ) {
    super(`${operation} timed out after ${waitedMs}ms`);
    this.name = "TimeoutError";
  }
}
```

### State Design

Discriminated unions over bags of booleans/optionals:

```typescript
// Bad
interface FetchState {
  isLoading: boolean;
  error?: Error;
  data?: Data;
}

// Good
type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "success"; data: Data };
```

---

## Testing Philosophy

Tests prove behavior, not structure. Every test should answer: "what user-visible or API-visible behavior does this verify?"

- **TDD**: Work in vertical slices - one test, one implementation, repeat
- **Determinism first**: No conditional assertions, no timing/randomness, no weak assertions
- **Real deps over mocks**: Database, APIs, file system - real in tests
- **Flaky tests are a bug**: Never remove a test because it's flaky; fix the variance source

---

## Critical Rules

1. **NEVER restart the daemon on port 6868** - that is the installed app's daemon over `~/.otto`, and restarting it kills your own process. Dev runs on `6788` over `packages/desktop/.dev/otto-home`; see [docs/development.md](../../docs/development.md).
2. **NEVER assume timeouts need a restart** - they can be transient
3. **Always run `npm run typecheck` after changes**
4. **NEVER add auth checks to tests** - agent providers handle their own auth
5. **NEVER make breaking WebSocket/message schema changes.** The protocol contract is always backward-compatible; the per-feature contract is not. The root AGENTS.md carries the full rule, including capability gating via `server_info.features.*` and the `COMPAT(name)` tagging convention.

---

## Where things live

Agent state persists to `$OTTO_HOME/agents/{cwd-with-dashes}/{agent-id}.json`.
Daemon logs: `$OTTO_HOME/daemon.log`.

---

## Debugging

```bash
npm run cli -- inspect <agent-id>   # Detailed agent info
npm run db:query -- "SELECT * FROM agent_timeline_rows..."
```

---

## Relevant Docs

| File                                                       | What it covers                                   |
| ---------------------------------------------------------- | ------------------------------------------------ |
| [../../AGENTS.md](../../AGENTS.md)                         | Repository overview, critical rules, quick start |
| [docs/architecture.md](../../docs/architecture.md)         | System design, WebSocket protocol, data flow     |
| [docs/coding-standards.md](../../docs/coding-standards.md) | Type hygiene, error handling, React patterns     |
| [docs/testing.md](../../docs/testing.md)                   | TDD workflow, determinism, real deps over mocks  |
