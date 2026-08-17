# Kanban Phase 4 - the board target in Project Settings

Read [README.md](README.md) in this directory first. It carries the decided
architecture, what already shipped, and the rules every unit must follow.

## Goal

A project's Kanban board target is chosen in that project's settings and stored
in the project record. Nothing else in this phase touches the board screen.

The target is a **pointer, never a credential**:

```ts
{ adapter: "github" | "jira", boardId: string | null }
```

- `adapter: "github"`, `boardId: null` - derive the boards from this project's
  git remote. This is the zero-configuration case and the GitHub default.
- `adapter: "github"`, `boardId: "PVT_kwDO..."` - one explicit Projects v2 board.
- `adapter: "jira"`, `boardId: "100"` - one Jira board. Required for Jira; a
  Jira board is site-addressed and cannot be derived from anything.

The server half already exists (see README). This phase adds the wire path to
**write** the target and to **read it back into the app**, then the UI.

## Definition of done

- A user opens Settings -> Projects -> a project, picks GitHub or Jira, fills in
  the board field, and the choice survives a daemon restart.
- The app can see a project's configured target without asking the board screen.
- A board id field never accepts a secret, and nothing about this field is
  masked, because it is equivalent to a URL.
- `npm run typecheck` clean for `@otto-code/protocol`, `@otto-code/client`,
  `@otto-code/server`, `@otto-code/app`. Lint and format clean.

---

## Unit 4.1 - Protocol: read the target back, and a setter RPC

**Files:** `packages/protocol/src/messages.ts`

### 4.1a - Surface the target on the project descriptor

Find `projectCustomName` in the workspace descriptor payload schema (around line
9131; search for `COMPAT(projectCustomName)`). Add a sibling field on the same
object:

```ts
// The project's Kanban board target, so the Kanban screen can tell a
// configured project from an unconfigured one without a round-trip. A
// pointer, never a credential - safe to echo in the clear.
// COMPAT(projectKanbanTarget): added in v0.8.11, drop the optional gate when
// floor >= v0.8.11.
projectKanban: ProjectKanbanTargetSchema.nullable().optional(),
```

Define the shared schema above it:

```ts
export const ProjectKanbanTargetSchema = z
  .object({
    adapter: z.enum(["github", "jira"]),
    // Null on the github adapter means "derive from the project's git remote".
    boardId: z.string().nullable().optional(),
  })
  .passthrough();

export type ProjectKanbanTarget = z.infer<typeof ProjectKanbanTargetSchema>;
```

Use `.passthrough()`, not `.strict()`: this is a wire schema on an inbound
container and must tolerate fields a newer daemon adds.

### 4.1b - The setter RPC

Add a request/response pair following
[docs/rpc-namespacing.md](../docs/rpc-namespacing.md). Model the shape on
`ProjectRenameRequestSchema` / `ProjectRenameResponsePayloadSchema` (search
`project.rename.request` in the same file) - same accepted/error reporting
shape, same registration pattern.

```ts
export const KanbanProjectTargetSetRequestSchema = z.object({
  type: z.literal("kanban.project.target.set.request"),
  projectId: z.string().min(1),
  // Null clears the target and returns the project to "no board configured".
  target: ProjectKanbanTargetSchema.nullable(),
  requestId: z.string(),
});

export const KanbanProjectTargetSetResponsePayloadSchema = z.object({
  requestId: z.string(),
  projectId: z.string(),
  accepted: z.boolean(),
  target: ProjectKanbanTargetSchema.nullable(),
  error: z.string().nullable(),
});
```

Register both in the inbound/outbound message unions exactly the way
`project.rename` is registered. Grep `project.rename.request` and mirror **every**
site it appears in.

**Acceptance:** `npm run build:client` succeeds (it regenerates the AOT
validators). `npx vitest run packages/protocol/src/wire-compat.test.ts --bail=1`
passes if that file exists; also run
`npx vitest run packages/server/src/server/wire-compat.test.ts --bail=1`.

---

## Unit 4.2 - Client: the setter method

**File:** `packages/client/src/daemon-client.ts`

Add a method next to `kanbanListBoards` (around line 3758), following the exact
shape of the neighbouring Kanban methods:

```ts
async kanbanSetProjectTarget(
  input: { projectId: string; target: ProjectKanbanTarget | null },
  requestId?: string,
): Promise<KanbanProjectTargetSetResponse["payload"]> {
  return this.sendNamespacedCorrelatedSessionRequest<"kanban.project.target.set.response">({
    requestId,
    message: {
      type: "kanban.project.target.set.request",
      projectId: input.projectId,
      target: input.target,
      requestId: "",
    },
    timeout: 30000,
  });
}
```

Import the new types from `@otto-code/protocol/messages` alongside the existing
Kanban imports.

**Acceptance:** `npm run typecheck --workspace=@otto-code/client`.

---

## Unit 4.3 - Server: persist the target and echo it back

**Files:** `packages/server/src/server/session.ts`

### 4.3a - Handle the setter

Find the `project.rename.request` case in the session's message switch and add a
`kanban.project.target.set.request` case beside it. The handler:

1. Loads the project via `this.projectRegistry.get(msg.projectId)`.
2. If absent, responds `accepted: false` with an error naming the project id.
3. **Validates before persisting.** Reject with an explicit error when:
   - `adapter === "jira"` and `boardId` is null or blank - a Jira board id is
     required.
   - `boardId` looks like a secret rather than a pointer. Reject any value
     longer than 200 characters, and any value matching
     `/^(ghp_|gho_|github_pat_|ATATT|xox)/` - those are token prefixes, and this
     field must never become a credential store.
4. Persists via `this.projectRegistry.upsert({ ...project, kanban: normalized, updatedAt: <iso> })`.
   Follow how the rename handler writes `customName` - same reconciliation-safe
   treatment, same timestamp handling.
5. Responds with `accepted: true` and the normalized target.

Normalization, before persisting:

- Trim `boardId`; an empty string becomes `null`.
- GitHub: accept a raw node id, a board number, or a full URL. Parse
  `https://github.com/orgs/<org>/projects/<n>` and
  `https://github.com/users/<user>/projects/<n>` down to `<n>`. Store whatever
  the user gave once trimmed; the provider resolves numbers to node ids.
- Jira: accept a board id, or a board URL containing `/boards/<id>` or
  `/b/<id>/`, and store just the parsed id.

Put the parsing in a small pure exported helper so it can be unit-tested without
a session:

**New file:** `packages/server/src/server/kanban/project-target.ts`

```ts
export function normalizeKanbanProjectTarget(input: {
  adapter: "github" | "jira";
  boardId?: string | null;
}):
  | { ok: true; target: { adapter: "github" | "jira"; boardId: string | null } }
  | { ok: false; error: string };
```

### 4.3b - Echo the target on the descriptor

Find `projectCustomName` in `session.ts` (the descriptor-building path, search
`projectCustomName:`) and add `projectKanban: project.kanban ?? null` beside it,
so the app receives the target with the project descriptor it already gets.

**Acceptance:**

- New test file `packages/server/src/server/kanban/project-target.test.ts`
  covering: jira without a board id is rejected; a token-looking board id is
  rejected; a GitHub org project URL parses to its number; a Jira `/b/100/` URL
  parses to `100`; an empty string becomes null.
- `npx vitest run packages/server/src/server/kanban/project-target.test.ts --bail=1`
- `npm run typecheck --workspace=@otto-code/server`

---

## Unit 4.4 - App: surface the target in the session store

**File:** `packages/app/src/stores/session-store.ts`

Add to `ProjectDescriptor` (line 268) and to `normalizeProjectDescriptor`
(line 277):

```ts
projectKanban: ProjectKanbanTarget | null;
```

normalized as `payload.projectKanban ?? null`.

Then add it to `ProjectHostEntry` in `packages/app/src/utils/projects.ts`
(line 15) and populate it wherever that entry is built, so the projects list and
the Kanban screen can both read it. Follow how `projectCustomName` flows through
that file.

**Acceptance:** `npm run typecheck --workspace=@otto-code/app`.

---

## Unit 4.5 - App: i18n strings

**Files:** `packages/app/src/i18n/resources/{en,fr,es,pt-BR,ja,zh-CN,ru,ar}.ts`

Add under the project-settings namespace (find where the project settings screen
already reads its keys - grep `settings.projectSettings` or the keys used by
`ProjectNameEditor` in `project-settings-screen.tsx`, and nest beside them):

```ts
kanban: {
  sectionTitle: "Kanban",
  description: "The tracking board this project shows on the Kanban screen.",
  adapter: "Board provider",
  adapterNone: "None",
  adapterGithub: "GitHub Projects",
  adapterJira: "Jira",
  githubBoard: "Board",
  githubBoardHint:
    "Leave empty to use the boards on this project's GitHub repository. Otherwise paste a project board number or URL.",
  githubBoardPlaceholder: "Board number or URL",
  jiraBoard: "Board",
  jiraBoardHint: "The Jira board id, or the board URL. Required for Jira.",
  jiraBoardPlaceholder: "Board id or URL",
  credentialsHint: "Sign-in for both providers is configured once per host in Settings.",
  saveError: "Couldn't save the Kanban board target.",
  jiraBoardRequired: "Enter a Jira board id.",
},
```

Translate for the other 7 locales. Keep product names ("GitHub Projects",
"Jira", "Kanban") untranslated.

**Acceptance:** `npm run typecheck --workspace=@otto-code/app` - it fails loudly
if any locale is missing a key.

---

## Unit 4.6 - App: the Kanban section UI

**File:** `packages/app/src/screens/project-settings-screen.tsx`

Add a `KanbanSection` component and render it inside the project settings body,
after the existing sections (see `ProjectLinksSection` at line 968 for the exact
pattern to copy: props of `{ serverId, projectId, client }`, a `useMutation`, and
a `SettingsSection` wrapper).

Requirements:

- A segmented control for the adapter with three options: **None**, **GitHub
  Projects**, **Jira**. Reuse the segmented control the settings screens already
  use; grep for an existing segmented/option row in
  `packages/app/src/screens/settings/` rather than building one.
- Selecting **None** saves `target: null` immediately.
- Selecting **GitHub Projects** reveals one optional text field. Empty is valid
  and is the recommended default; the hint must explain that empty means "use
  this project's repository".
- Selecting **Jira** reveals one required text field. Save is blocked and
  `jiraBoardRequired` is shown while it is empty.
- Fields commit on blur and on submit, exactly like the Atlassian card in
  `git-providers-settings-cards.tsx` (`onBlur` + `onSubmitEditing`, skip the
  mutation when the trimmed value is unchanged).
- Render `credentialsHint` as a static hint. Do **not** add credential inputs
  here; they live in host settings and this phase must not duplicate them.
- On mutation error show `saveError`, matching how `renderSaveError` works in the
  git providers card.
- Give the section `testID="project-kanban-section"`, the segmented control
  `testID="project-kanban-adapter"`, and the board input
  `testID="project-kanban-board-input"`.

Keep the component under the lint complexity ceiling of 20. If it goes over,
extract the adapter-specific field into a small `KanbanBoardField` component
rather than adding an eslint-disable.

**Acceptance:**

- `npm run typecheck --workspace=@otto-code/app`
- `npm run lint -- packages/app/src/screens/project-settings-screen.tsx`
- Manual: the section renders, a Jira selection with an empty board blocks save,
  a GitHub selection with an empty board saves.

---

## Unit 4.7 - Tests

**New file:** `packages/app/src/screens/project-settings-kanban.test.ts`

Test the pure logic only, not the component tree - follow the style of
`packages/app/src/screens/kanban-screen-state.ts` and its test: extract a small
pure function for "is this draft savable, and what does it save" and test that.

Suggested extraction, in `project-settings-screen.tsx` or a sibling module:

```ts
export function resolveKanbanTargetDraft(input: {
  adapter: "none" | "github" | "jira";
  boardId: string;
}):
  | { kind: "save"; target: ProjectKanbanTarget | null }
  | { kind: "blocked"; reason: "jiraBoardRequired" };
```

Cases: none saves null; github with empty board saves `{adapter:"github",boardId:null}`;
github with a value saves it trimmed; jira with empty board is blocked; jira with
a value saves it trimmed.

**Acceptance:** `npx vitest run packages/app/src/screens/project-settings-kanban.test.ts --bail=1`

---

## Out of scope for phase 4

- Anything on the `/kanban` screen. That is phase 5.
- Validating that the board actually exists. The settings connection-check
  buttons cover credentials; a wrong board id surfaces on the board screen.
- Multi-host projects. The target is per (host, project) record, which is what
  the existing project settings host picker already scopes to.
