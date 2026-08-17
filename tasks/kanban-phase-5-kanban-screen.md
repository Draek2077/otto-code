# Kanban Phase 5 - the screen: host picker, project picker, board

Read [README.md](README.md) in this directory first. It carries the decided
architecture, what already shipped, and the rules every unit must follow.

**Depends on phase 4** for `projectKanban` on the project descriptor. Units 5.1
and 5.2 can start before phase 4 lands; 5.4 onward cannot.

## Goal

Rebuild `/kanban` around the decided access model:

```
host picker  ->  project picker (that host's projects)  ->  board
```

The screen never picks a provider. It names a project; the daemon resolves the
project's target to a provider and a board (already implemented - see README).
A project with no target configured renders a watermark with a link into that
project's settings.

## What is wrong with the screen today

`packages/app/src/screens/kanban-screen.tsx` currently:

- Hard-codes `PROVIDER_OPTIONS = ["memory", "github"]` (line 44) and fans out
  host x provider, so Jira is unreachable and the mock board is a first-class
  user-visible option.
- Groups the picker by provider (`KanbanBoardPicker`, line 263), exposing an
  implementation detail the user should never see.
- Swallows every board-list failure into an empty list (`loadBoardsForHost`,
  line 164), so a real error is indistinguishable from an empty account.
- Tells the user to "Add a personal access token ... in the daemon config"
  (line 415). That is now false: GitHub uses the `gh` CLI and there is no such
  config.

## Definition of done

- The memory provider is unreachable from the UI (its server registration and
  tests stay - do not delete those).
- No provider name appears in the picker chrome.
- An unconfigured project links straight to its settings.
- A board-list error is shown, not swallowed.
- `npm run typecheck --workspace=@otto-code/app` clean, lint and format clean,
  `kanban-screen-state.test.ts` passing.

---

## Unit 5.1 - Client: pass the project on the boards request

**File:** `packages/client/src/daemon-client.ts` (line 3758)

The wire already carries the fields; the client method does not send them.

```ts
async kanbanListBoards(
  input: { providerId: string; projectId?: string; projectKey?: string },
  requestId?: string,
): Promise<KanbanBoardsListResponse["payload"]> {
  return this.sendNamespacedCorrelatedSessionRequest<"kanban.boards.list.response">({
    requestId,
    message: {
      type: "kanban.boards.list.request",
      providerId: input.providerId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.projectKey ? { projectKey: input.projectKey } : {}),
      requestId: "",
    },
    timeout: 60000,
  });
}
```

Note this changes the signature from positional to an object parameter. Update
both call sites in `packages/app/src/kanban/kanban-hooks.ts` (line 50) and
`packages/app/src/screens/kanban-screen.tsx` (line 165). The daemon still needs
a `providerId` on the wire for older clients, so keep sending it; pass
`"github"` as an inert default when the project is supplied, because the daemon
overrides it from the resolved target.

**Acceptance:** `npm run typecheck --workspace=@otto-code/client` and
`--workspace=@otto-code/app`.

---

## Unit 5.2 - The screen state machine

**File:** `packages/app/src/screens/kanban-screen-state.ts`

This module is deliberately React-free so it is testable without mounting
anything. Replace the current three-state machine with the states the new flow
needs:

```ts
export type KanbanScreenBodyState =
  | { kind: "loading" }
  // No connected host advertises the kanban feature.
  | { kind: "no-hosts" }
  // A host is selected but has no projects.
  | { kind: "no-projects" }
  // A project is selected but has no board target configured. Carries what the
  // watermark needs to link into that project's settings.
  | { kind: "unconfigured"; serverId: string; projectId: string }
  // A project is selected and its boards failed to load.
  | { kind: "error"; message: string }
  // Boards are known; render the board picker and the board.
  | { kind: "board" };

export function resolveKanbanScreenBodyState(input: {
  isLoading: boolean;
  hostCount: number;
  projectCount: number;
  selectedProject: { serverId: string; projectId: string; hasTarget: boolean } | null;
  boardError: string | null;
  boardCount: number;
}): KanbanScreenBodyState;
```

Precedence, in order:

1. `hostCount === 0` -> `no-hosts` (even while loading; there is nothing to wait
   for).
2. `isLoading && boardCount === 0` -> `loading`.
3. `projectCount === 0` -> `no-projects`.
4. `selectedProject === null` -> `no-projects` (nothing chosen yet and nothing
   to choose).
5. `!selectedProject.hasTarget` -> `unconfigured` carrying the project's ids.
6. `boardError` -> `error`.
7. otherwise -> `board`.

**Acceptance:** rewrite `packages/app/src/screens/kanban-screen.test.ts` (it
currently tests the old machine) to cover each precedence rule, including that
`no-hosts` beats `loading` and that `unconfigured` beats `boardError`.
`npx vitest run packages/app/src/screens/kanban-screen.test.ts --bail=1`.

---

## Unit 5.3 - i18n strings

**Files:** `packages/app/src/i18n/resources/{en,fr,es,pt-BR,ja,zh-CN,ru,ar}.ts`

Add a `kanban` namespace at the same level as the other screen namespaces:

```ts
kanban: {
  title: "Boards",
  host: "Host",
  project: "Project",
  refresh: "Refresh boards",
  noHostsTitle: "No boards available",
  noHostsBody: "Connect a host with the Kanban feature to see its boards.",
  noProjectsTitle: "No projects on this host",
  noProjectsBody: "Open a project on this host to track it on a board.",
  unconfiguredTitle: "No board configured",
  unconfiguredBody: "Choose a GitHub or Jira board for this project to see it here.",
  unconfiguredAction: "Open project settings",
  boardError: "Couldn't load boards",
  addCard: "Add card",
  cardTitlePlaceholder: "Card title",
  cancel: "Cancel",
  moveTo: "Move to {{column}}",
},
```

The screen currently hard-codes English strings inline ("Boards", "Add card",
"Cancel", "Move to ..."). Move every one of them to these keys as you touch the
components. Translate for all 7 other locales; the app will not typecheck
otherwise.

**Acceptance:** `npm run typecheck --workspace=@otto-code/app`.

---

## Unit 5.4 - Host and project pickers

**File:** `packages/app/src/screens/kanban-screen.tsx`

Delete `useKanbanBoardOptions`, `mergeBoardOptions`, `loadBoardsForHost`,
`KanbanBoardPicker`, `KanbanPickerChip`, `PROVIDER_OPTIONS`, `providerLabel`,
and the `KanbanProviderId` type. Replace with two pickers.

**Host picker.** Source hosts from `useHosts()` filtered by
`useKanbanBoardFeature(serverId)` and a live client, the same filter
`useKanbanBoardOptions` uses today (line 92). Auto-select when there is exactly
one; hide the picker entirely in that case.

**Project picker.** Source from the existing `useProjects()` hook
(`packages/app/src/hooks/use-projects.ts`), filtered to the selected host. Each
entry is a `ProjectHostEntry` (`packages/app/src/utils/projects.ts` line 15),
which after phase 4 carries `projectKanban`.

Both pickers reuse the existing chip row styling already in this file
(`styles.picker`, `styles.pickerRow`, `styles.pickerChip*`) - keep the visual
language, change only what it is listing. Label the rows with
`t("kanban.host")` and `t("kanban.project")`.

Selection state:

```ts
interface KanbanSelection {
  serverId: string;
  projectId: string;
  projectKey: string | null;
  boardId: string | null; // chosen board once the list resolves
}
```

Persist the last selection per host in component state only; do not add a new
persisted setting in this phase.

**Acceptance:** `npm run typecheck --workspace=@otto-code/app`, lint clean.

---

## Unit 5.5 - The unconfigured watermark

**File:** `packages/app/src/screens/kanban-screen.tsx`

When the state machine returns `unconfigured`, render a centered watermark using
the existing `styles.centered` / `styles.message` / `styles.messageSub` styles:

- Title `kanban.unconfiguredTitle`, body `kanban.unconfiguredBody`.
- A `Button` labelled `kanban.unconfiguredAction` that calls
  `router.navigate(buildProjectSettingsRoute(serverId, projectId))`. That helper
  is already exported from `packages/app/src/utils/host-routes.ts` (line 608) -
  import it, do not write a path literal.
- `testID="kanban-unconfigured"` on the container and
  `testID="kanban-open-project-settings"` on the button.

The daemon also answers an unconfigured project with the exact string exported as
`KANBAN_NOT_CONFIGURED` from
`packages/server/src/server/kanban/kanban-session.ts`. Treat that response as the
`unconfigured` state too, not as an error, so a project whose descriptor is stale
still lands on the watermark rather than a raw error message. Compare against the
constant; do not copy the sentence into the app.

**Acceptance:** typecheck and lint clean; the watermark renders for a project
with no target.

---

## Unit 5.6 - Board list and board view

**File:** `packages/app/src/screens/kanban-screen.tsx`

- Fetch boards for the selected project with `useKanbanBoards` from
  `packages/app/src/kanban/kanban-hooks.ts`, updated in 5.1 to take the project.
  Update that hook's signature to accept `{ serverId, projectId, projectKey }`
  instead of `providerId`.
- **Surface errors.** `useKanbanBoards` already returns `error`; feed it into the
  state machine's `boardError`. Delete the swallow-to-empty behaviour that
  `loadBoardsForHost` had.
- If the project resolves to exactly one board, select it and hide the board
  chip row. Otherwise show the board chips, unlabelled by provider.
- `KanbanBoardView` (line 354) keeps its drag-and-drop, column, and card
  rendering as-is. Change only its inputs: it takes the resolved
  `{ serverId, providerId, boardId }` where `providerId` now comes from the
  board ref returned by the daemon (`KanbanBoardRef.providerId`), never from a
  hard-coded list.
- **Delete the stale GitHub hint** at line 413-417 ("Add a personal access token
  ... in the daemon config"). The provider's own error message is now accurate
  and self-explanatory; render `error` alone.

**Acceptance:** `npm run typecheck --workspace=@otto-code/app`, lint clean.
Manual: a GitHub-configured project shows its board; a Jira-configured project
shows its board; an error shows its message.

---

## Unit 5.7 - Cleanup and changelog

- Confirm `memory` appears nowhere under `packages/app/src`:
  `rg "\"memory\"" packages/app/src`. Its server registration in
  `packages/server/src/server/kanban/kanban-registry.ts` and
  `memory-provider.test.ts` **stay**.
- Grep for now-dead references: `rg "PROVIDER_OPTIONS|providerLabel" packages/app/src`.
- Check whether the `COMPAT(kanbanBoard)` gate in `kanban-hooks.ts` (line 8) is
  still needed; keep it unless the daemon floor has moved past v0.8.11.
- Add a `CHANGELOG.md` entry under the unreleased heading, matching the file's
  existing voice and following [docs/writing-style.md](../docs/writing-style.md)
  (no em-dashes). Cover the user-visible facts only:
  - Kanban boards are now reached by picking a host and a project.
  - The board for a project is chosen in that project's settings.
  - GitHub boards use the GitHub CLI sign-in; Jira uses the Atlassian account
    credential shared with Bitbucket.
  - Jira boards now use the board's real columns and moving a card transitions
    the issue.

**Acceptance:** `npm run format`, `npm run lint`, both typechecks, and
`npx vitest run packages/app/src/screens/kanban-screen.test.ts --bail=1`.

---

## Out of scope for phase 5

- `kanban.task.link` has full wire, session, and client plumbing but no app
  caller. Leave it that way; wiring a "link an existing issue" action is its own
  piece of work.
- Greying out Jira columns the current workflow cannot transition into. Recorded
  as an open item on the Jira finding in Otto Knowledge.
- Board pagination. Both providers currently cap at 100-200 items per read.
