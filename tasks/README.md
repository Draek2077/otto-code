# tasks/

Work orders. Each file breaks one build phase into units small enough for a
single focused agent session, with exact file paths, exact contracts, and
acceptance criteria.

These are **not** project knowledge and **not** `docs/`. They are disposable:
delete a task file once its phase has shipped and its durable facts have landed
in `docs/` or Otto Knowledge.

| File                                                                     | Phase                                | Status  |
| ------------------------------------------------------------------------ | ------------------------------------ | ------- |
| [kanban-phase-4-project-settings.md](kanban-phase-4-project-settings.md) | Kanban target in project settings    | Shipped |
| [kanban-phase-5-kanban-screen.md](kanban-phase-5-kanban-screen.md)       | Kanban screen host + project pickers | Shipped |

## Shared context for both Kanban phases

Read these first. They are decided; do not re-litigate them.

- Otto Knowledge decision **"Kanban is reached via host + project pickers; the
  board target is configured per project in Project Settings"** (confirmed).
- Otto Knowledge reference **"GitHub + Atlassian (Jira) token scopes required for
  the Kanban providers"** (confirmed) - scope copy is already in the settings
  cards, do not restate it elsewhere.
- Otto Knowledge finding **"The Jira Kanban provider targeted endpoints that do
  not exist in Jira Cloud"** - explains the Jira column model you will render.

### What already shipped (phases 1-3, in the working tree)

Do not redo any of this.

- **Credentials.** GitHub Kanban authenticates through the `gh` CLI
  (`packages/server/src/server/kanban/github-cli-token.ts`). Jira uses the shared
  Atlassian credential (`gitHosting.providers.atlassian`: `email`, `apiToken`,
  `jiraSiteUrl`) read via
  `packages/server/src/services/git-hosting/atlassian-credentials.ts`. There are
  no Kanban-specific token slots and none may be added.
- **Settings cards.** `packages/app/src/screens/settings/git-providers-settings-cards.tsx`
  has a GitHub card (gh auth status + scopes) and an Atlassian card (email, API
  token, Jira site, scopes). i18n under `settings.host.gitProviders.{github,atlassian}`
  in all 8 locales.
- **Protocol.** `kanban.boards.list.request` already carries optional
  `projectId` and `projectKey` (`packages/protocol/src/kanban.ts`). All 14 Kanban
  schemas are `.strict()`.
- **Project record.** `PersistedProjectRecord` already has an optional
  `kanban: { adapter: "github" | "jira"; boardId: string | null } | null` field
  (`packages/server/src/server/workspace-registry.ts`).
- **Daemon resolution.** `KanbanSession.handleBoardsListRequest` resolves a
  project-scoped request through `KanbanSessionHost.resolveProjectTarget`, which
  `Session.resolveKanbanProjectTarget` implements
  (`packages/server/src/server/session.ts`). An unconfigured project answers with
  the exported constant `KANBAN_NOT_CONFIGURED` from
  `packages/server/src/server/kanban/kanban-session.ts`.

### Rules that apply to every unit here

- Read `AGENTS.md` at the repo root, plus `packages/app/AGENTS.md` for any app
  work and `packages/server/AGENTS.md` for any server work.
- **Never run a full test suite.** Run only the file you changed:
  `npx vitest run <file> --bail=1`.
- Run `npm run typecheck --workspace=<pkg>` and
  `npm run lint -- <paths>` after every unit, and `npm run format` before
  committing.
- Rebuild declarations before diagnosing cross-package type errors:
  `npm run build:client` (protocol + client), `npm run build:server`.
- Protocol changes are additive only: new fields are `.optional()`, never flip
  optional to required, never remove a field. New RPCs use dotted namespaces per
  [docs/rpc-namespacing.md](../docs/rpc-namespacing.md).
- Every back-compat shim carries a `COMPAT(name)` comment with the version added
  and a removal date about 6 months out.
- i18n resources are structurally typechecked: a key added to `en.ts` **must** be
  added to all 7 other locales in `packages/app/src/i18n/resources/` or the app
  will not typecheck.
- Commits are authored as `Draekz <draekz@gmail.com>` with no AI attribution
  trailer of any kind.
