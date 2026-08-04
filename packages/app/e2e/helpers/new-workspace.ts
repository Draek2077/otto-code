import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { DaemonClient as InternalDaemonClient } from "@otto-code/client/internal/daemon-client";
import { decodeWorkspaceIdFromPathSegment } from "@/utils/host-routes";
import { connectDaemonClient } from "./daemon-client-loader";
import { daemonWsRoutePattern } from "./daemon-port";
import { expectWorkspaceHeader } from "./workspace-ui";

type NewWorkspaceDaemonClient = Pick<
  InternalDaemonClient,
  | "addProject"
  | "archiveOttoWorktree"
  | "archiveWorkspace"
  | "checkoutRefresh"
  | "close"
  | "connect"
  | "createOttoWorktree"
  | "createWorkspace"
  | "fetchWorkspaces"
  | "getOttoWorktreeList"
  | "getDaemonConfig"
  | "inspectWorkspaceRecovery"
  | "listProjects"
  | "on"
  | "patchDaemonConfig"
  | "removeProject"
>;

type CreateWorkspacePayload = Awaited<ReturnType<NewWorkspaceDaemonClient["createWorkspace"]>>;
type WorkspacePayload = Pick<CreateWorkspacePayload, "error" | "workspace">;
type WorkspaceDescriptor = NonNullable<CreateWorkspacePayload["workspace"]>;

export interface OpenedProject {
  workspaceId: string;
  projectId: string;
  projectKey: string;
  projectDisplayName: string;
  workspaceName: string;
  workspaceDirectory: string;
}

function requireWorkspace(payload: WorkspacePayload) {
  if (payload.error) {
    throw new Error(payload.error);
  }
  if (!payload.workspace) {
    throw new Error("workspace.create returned no workspace.");
  }
  return payload.workspace;
}

async function openedProjectFromWorkspace(
  client: NewWorkspaceDaemonClient,
  workspace: WorkspaceDescriptor,
): Promise<OpenedProject> {
  const payload = await client.listProjects();
  const project = payload.projects.find((candidate) => candidate.projectId === workspace.projectId);
  if (!project?.projectKey) {
    throw new Error(`Project ${workspace.projectId} has no project key`);
  }
  return {
    workspaceId: workspace.id,
    projectId: workspace.projectId,
    projectKey: project.projectKey,
    projectDisplayName: workspace.projectDisplayName,
    workspaceName: workspace.name,
    workspaceDirectory: workspace.workspaceDirectory,
  };
}

async function fetchWorkspaceById(
  client: NewWorkspaceDaemonClient,
  workspaceId: string,
): Promise<WorkspaceDescriptor | null> {
  const payload = await client.fetchWorkspaces();
  return payload.entries.find((entry) => entry.id === workspaceId) ?? null;
}

async function waitForWorkspaceDescriptor(
  client: NewWorkspaceDaemonClient,
  workspaceId: string,
): Promise<WorkspaceDescriptor> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const workspace = await fetchWorkspaceById(client, workspaceId);
    if (workspace) {
      return workspace;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Workspace descriptor not found: ${workspaceId}`);
}

function parseWorkspaceIdFromPageUrl(page: Page, serverId: string): string | null {
  const pathname = new URL(page.url()).pathname;
  const match = pathname.match(
    new RegExp(`^/h/${serverId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/workspace/([^/?#]+)`),
  );
  if (!match?.[1]) {
    return null;
  }
  return decodeWorkspaceIdFromPathSegment(match[1]);
}

export async function connectNewWorkspaceDaemonClient(options?: {
  port?: number;
}): Promise<NewWorkspaceDaemonClient> {
  return connectDaemonClient<NewWorkspaceDaemonClient>({
    clientIdPrefix: "app-e2e-new-workspace",
    port: options?.port,
  });
}

export async function openProjectViaDaemon(
  client: NewWorkspaceDaemonClient,
  repoPath: string,
): Promise<OpenedProject> {
  const workspace = requireWorkspace(
    await client.createWorkspace({
      source: { kind: "directory", path: repoPath },
    }),
  );
  return openedProjectFromWorkspace(client, workspace);
}

export interface RegisteredProject {
  /** Host-local identity. What `removeProject` and other daemon calls take. */
  projectId: string;
  /** Opaque cross-host grouping key. What the composer's picker renders. */
  projectKey: string;
  projectDisplayName: string;
}

/**
 * Register a directory as a project WITHOUT creating a workspace for it (the
 * `emptyProjects` case). `openProjectViaDaemon` also backs the directory with a
 * "main" workspace, which makes the new-workspace composer refuse to create a
 * second workspace on it ("This directory already backs the workspace …") - use
 * this when the spec needs a composer-selectable, workspace-free target.
 *
 * The two ids are not interchangeable and `project.add` only answers with the
 * host-local one. The picker's option testID is keyed by the grouping key
 * (`new-workspace-project-picker-option-${project.projectKey}` in
 * new-workspace-screen.tsx), so returning `projectId` under the name
 * `projectKey` made `selectNewWorkspaceProject` wait 30s for an option that
 * could never match. Resolve the real key the way `openProjectViaDaemon` does.
 */
export async function addProjectViaDaemon(
  client: NewWorkspaceDaemonClient,
  repoPath: string,
): Promise<RegisteredProject> {
  const payload = await client.addProject(repoPath);
  if (payload.error) {
    throw new Error(payload.error);
  }
  if (!payload.project) {
    throw new Error("project.add returned no project.");
  }
  const projectId = payload.project.projectId;
  const listed = await client.listProjects();
  const descriptor = listed.projects.find((candidate) => candidate.projectId === projectId);
  if (!descriptor?.projectKey) {
    throw new Error(`Project ${projectId} has no project key`);
  }
  return {
    projectId,
    projectKey: descriptor.projectKey,
    projectDisplayName: payload.project.projectDisplayName,
  };
}

export async function archiveWorkspaceFromDaemon(
  client: NewWorkspaceDaemonClient,
  workspaceDirectory: string,
  options?: { scope?: "workspace" | "worktree" },
): Promise<void> {
  const payload = await client.archiveOttoWorktree({
    worktreePath: workspaceDirectory,
    ...(options?.scope !== undefined ? { scope: options.scope } : {}),
  });
  if (payload.error) {
    throw new Error(payload.error.message);
  }
  if (!payload.success) {
    throw new Error(`Failed to archive workspace: ${workspaceDirectory}`);
  }
}

export async function archiveLocalWorkspaceFromDaemon(
  client: NewWorkspaceDaemonClient,
  workspaceId: string,
): Promise<void> {
  const payload = await client.archiveWorkspace(workspaceId);
  if (payload.error) {
    throw new Error(payload.error);
  }
  if (!payload.archivedAt) {
    throw new Error(`Failed to archive workspace: ${workspaceId}`);
  }
}

export async function createWorktreeViaDaemon(
  client: NewWorkspaceDaemonClient,
  input: { cwd: string; slug: string },
): Promise<OpenedProject> {
  const payload = await client.createOttoWorktree({
    cwd: input.cwd,
    worktreeSlug: input.slug,
  });
  const workspace = requireWorkspace(payload);
  return openedProjectFromWorkspace(client, workspace);
}

export async function openNewWorkspaceComposer(
  page: Page,
  input: { projectKey: string; projectDisplayName: string },
): Promise<void> {
  const projectRow = page.getByTestId(`sidebar-project-row-${input.projectKey}`).first();
  await expect(projectRow).toBeVisible({ timeout: 30_000 });
  await projectRow.hover();

  const button = page.getByTestId(`sidebar-project-new-worktree-${input.projectKey}`).first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();

  await expect(page).toHaveURL(/\/new(?:\?.*)?$/, {
    timeout: 30_000,
  });
}

export async function openGlobalNewWorkspaceComposer(page: Page): Promise<void> {
  await page.getByTestId("sidebar-global-new-workspace").click();

  await expect(page).toHaveURL(/\/new(?:\?.*)?$/, {
    timeout: 30_000,
  });
}

export async function openNewWorkspaceProjectPickerWithShortcut(page: Page): Promise<void> {
  await page.keyboard.press("Control+P");

  const searchInput = page.getByPlaceholder("Search projects");
  await expect(searchInput).toBeVisible({ timeout: 30_000 });
  await expect(searchInput).toBeFocused();
}

export async function expectNewWorkspaceProjectSelected(
  page: Page,
  projectDisplayName: string,
): Promise<void> {
  const projectPicker = page.getByRole("button", { name: "Workspace project" });
  await expect(projectPicker).toBeVisible({ timeout: 30_000 });
  await expect(projectPicker).toContainText(projectDisplayName);
}

export async function fillNewWorkspaceDraft(page: Page, draft: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Message agent..." });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(draft);
}

export async function expectNewWorkspaceDraft(page: Page, draft: string): Promise<void> {
  await expect(page.getByRole("textbox", { name: "Message agent..." })).toHaveValue(draft);
}

export async function selectNewWorkspaceHost(page: Page, hostLabel: string): Promise<void> {
  await page.getByTestId("host-picker-trigger").click();
  await page.getByText(hostLabel, { exact: true }).click();
}

export async function submitNewWorkspacePrompt(
  page: Page,
  prompt = "Hello from e2e",
): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Message agent..." });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(prompt);
  const createButton = page
    .getByTestId("message-input-root")
    .getByRole("button", { name: "Create" });
  await expect(createButton).toBeVisible({ timeout: 30_000 });
  await createButton.click();
}

export async function clickNewWorkspaceButton(
  page: Page,
  input: { projectKey: string; projectDisplayName: string; prompt?: string },
): Promise<void> {
  await openNewWorkspaceComposer(page, input);
  await submitNewWorkspacePrompt(page, input.prompt);
}

export async function selectNewWorkspaceProject(
  page: Page,
  input: { projectKey: string; projectDisplayName: string },
): Promise<void> {
  const trigger = page.getByTestId("new-workspace-project-picker-trigger");
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();

  const option = page.getByTestId(`new-workspace-project-picker-option-${input.projectKey}`);
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();

  await expectNewWorkspaceProjectSelected(page, input.projectDisplayName);
}

// The isolation trigger renders the active isolation's label ("Local" / "New
// worktree"), so asserting its text proves what the screen currently remembers.
const ISOLATION_TRIGGER_LABEL: Record<"local" | "worktree", string> = {
  local: "Local",
  worktree: "New worktree",
};

export async function expectWorkspaceIsolationSelected(
  page: Page,
  isolation: "local" | "worktree",
): Promise<void> {
  const trigger = page.getByRole("button", { name: "Workspace isolation" });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await expect(trigger).toContainText(ISOLATION_TRIGGER_LABEL[isolation]);
}

export async function selectWorkspaceIsolation(
  page: Page,
  isolation: "local" | "worktree",
): Promise<void> {
  const trigger = page.getByTestId("workspace-create-isolation-trigger");
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();

  // "New worktree" is only listed once the checkout status query confirms the
  // selected project is a git repo, so wait for the option to appear before
  // clicking it.
  const option = page.getByTestId(`workspace-create-isolation-${isolation}`);
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
}

export async function submitNewWorkspaceEmpty(page: Page): Promise<void> {
  const createButton = page
    .getByTestId("message-input-root")
    .getByRole("button", { name: "Create" });
  await expect(createButton).toBeVisible({ timeout: 30_000 });
  await createButton.click();
}

/**
 * Answer the occupied-directory steer with "open the workspace that is already
 * there". One directory backs one live workspace, so a spec that seeds a
 * workspace on a temp repo and then submits a New Workspace draft against that
 * same project always lands on this dialog. Both of its branches carry the
 * submission through; opening the existing workspace is the cheap one, where
 * "create a worktree" shells out to `git worktree add` for no gain to a spec
 * that is not about isolation.
 */
export async function openExistingWorkspaceFromOccupiedSteer(page: Page): Promise<void> {
  const openIt = page.getByTestId("confirm-dialog-confirm");
  await expect(openIt).toBeVisible({ timeout: 30_000 });
  await openIt.click();
  await expect(openIt).toHaveCount(0, { timeout: 30_000 });
}

export async function openStartingRefPicker(page: Page): Promise<void> {
  const trigger = page.getByTestId("new-workspace-ref-picker-trigger");
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
}

export async function selectBranchInPicker(page: Page, name: string): Promise<void> {
  const branchRow = page.getByTestId(`new-workspace-ref-picker-branch-${name}`);
  await expect(branchRow).toBeVisible({ timeout: 30_000 });
  await branchRow.click();
}

export async function searchAndSelectBranchInPicker(page: Page, name: string): Promise<void> {
  const searchInput = page.getByPlaceholder("Search branches and PRs");
  await expect(searchInput).toBeVisible({ timeout: 30_000 });
  await searchInput.fill(name);
  await selectBranchInPicker(page, name);
}

export async function selectGitHubPrInPicker(page: Page, number: number): Promise<void> {
  const prRow = page.getByTestId(`new-workspace-ref-picker-pr-${number}`);
  await expect(prRow).toBeVisible({ timeout: 30_000 });
  await prRow.click();
}

export async function expectStartingRefPickerTriggerPr(
  page: Page,
  input: { number: number; title: string; headRef: string },
): Promise<void> {
  const trigger = page.getByRole("button", { name: "Starting ref" });
  await expect(trigger).toContainText(`#${input.number}`);
  await expect(trigger).toContainText(input.title);
  await expect(trigger).not.toContainText(input.headRef);
}

export async function openBranchPicker(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: "Starting ref" });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
}

export async function selectPickerOptionByKeyboard(page: Page, label: string): Promise<void> {
  const searchInput = page.getByPlaceholder("Search branches and PRs");
  await expect(searchInput).toBeVisible({ timeout: 30_000 });
  await page.keyboard.type(label);
  await expect(page.getByTestId(`new-workspace-ref-picker-branch-${label}`)).toBeVisible({
    timeout: 10_000,
  });
  await page.keyboard.press("Enter");
}

export async function closeBranchPicker(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
}

export async function expectPickerOpen(page: Page): Promise<void> {
  await expect(page.getByTestId("combobox-desktop-container")).toBeVisible({ timeout: 30_000 });
}

export async function expectPickerClosed(page: Page): Promise<void> {
  await expect(page.getByTestId("combobox-desktop-container")).not.toBeVisible({
    timeout: 30_000,
  });
}

export async function expectPickerSelected(page: Page, label: string): Promise<void> {
  const trigger = page.getByRole("button", { name: "Starting ref" });
  await expect(trigger).toContainText(label);
}

export async function expectComposerGithubAttachmentPill(
  page: Page,
  input: { number: number; title: string },
): Promise<void> {
  const pills = page.getByTestId("composer-github-attachment-pill");
  await expect(pills).toHaveCount(1);
  await expect(pills.first()).toContainText(`#${input.number}`);
  await expect(pills.first()).toContainText(input.title);
}

export async function pasteGithubPrUrl(
  page: Page,
  context: BrowserContext,
  url: string,
): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Message agent..." });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((value) => navigator.clipboard.writeText(value), url);
  await composer.focus();
  await page.keyboard.press("Control+V");
}

export async function assertNewWorkspaceSidebarAndHeader(
  page: Page,
  input: {
    serverId: string;
    client: NewWorkspaceDaemonClient;
    previousWorkspaceId: string;
    projectDisplayName: string;
    assertSidebarRow?: boolean;
    assertHeader?: boolean;
  },
): Promise<{ workspaceId: string; workspaceName: string; workspaceDirectory: string }> {
  // URL is the source of truth so concurrent sidebar rows cannot satisfy this.
  await expect
    .poll(
      () => {
        const workspaceId = parseWorkspaceIdFromPageUrl(page, input.serverId);
        return workspaceId && workspaceId !== input.previousWorkspaceId ? workspaceId : null;
      },
      { timeout: 60_000 },
    )
    .not.toBeNull();

  const workspaceId = parseWorkspaceIdFromPageUrl(page, input.serverId);
  if (!workspaceId || workspaceId === input.previousWorkspaceId) {
    throw new Error(`Expected URL to redirect to a new workspace.\nCurrent URL: ${page.url()}`);
  }

  const workspace = await waitForWorkspaceDescriptor(input.client, workspaceId);

  if (input.assertSidebarRow !== false) {
    const createdWorkspaceRow = page.getByTestId(
      `sidebar-workspace-row-${input.serverId}:${workspace.id}`,
    );
    await expect(createdWorkspaceRow.first()).toBeVisible({ timeout: 30_000 });
  }

  if (input.assertHeader !== false) {
    await expectWorkspaceHeader(page, {
      title: workspace.name,
      subtitle: input.projectDisplayName,
    });
  }

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceDirectory: workspace.workspaceDirectory,
  };
}

type WebSocketMessage = string | Buffer;

function parseWebSocketJson(message: WebSocketMessage): unknown {
  const rawMessage = typeof message === "string" ? message : message.toString("utf8");
  try {
    return JSON.parse(rawMessage);
  } catch {
    return null;
  }
}

function getSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const envelope = parseWebSocketJson(message);
  if (!envelope || typeof envelope !== "object") {
    return null;
  }
  const maybeEnvelope = envelope as { type?: unknown; message?: unknown };
  if (maybeEnvelope.type !== "session" || !maybeEnvelope.message) {
    return null;
  }
  if (typeof maybeEnvelope.message !== "object") {
    return null;
  }
  return maybeEnvelope.message as Record<string, unknown>;
}

function getStringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" ? value : null;
}

export interface AgentCreatedDelayControl {
  release(): void;
  waitForCreateRequest(timeoutMs?: number): Promise<void>;
  waitForDelayedCreatedStatus(timeoutMs?: number): Promise<void>;
}

/**
 * Ceiling for either gate below. Both wait on a WebSocket message that the app
 * only sends when everything upstream of it succeeded, so a gate that never
 * opens is the normal shape of a break here - and an unbounded wait spends the
 * whole test timeout to report nothing at all. Bounded well under a spec's
 * timeout, the failure arrives with the daemon's own error text attached, which
 * is almost always the answer: when workspace creation is refused, no create
 * request ever follows.
 */
const AGENT_CREATED_GATE_TIMEOUT_MS = 30_000;

/** Enough daemon errors to spot the pattern, few enough to stay readable. */
const MAX_RECORDED_GATE_ERRORS = 5;

/** Guards the request-type list against an unbounded chatty session. */
const MAX_RECORDED_REQUEST_TYPES = 40;

/**
 * The error a daemon message carries, if any. Deliberately shape-driven rather
 * than keyed to specific message types: `rpc_error`, the `*.response` payloads
 * and the `agent_create_failed` status all report through a payload `error`,
 * and a gate diagnosis wants whichever one arrived.
 */
function errorText(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    return getStringField(error as Record<string, unknown>, "message");
  }
  return null;
}

function extractDaemonError(sessionMessage: Record<string, unknown>): string | null {
  const payload = sessionMessage.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const text = errorText(record.error);
  if (!text) {
    return null;
  }
  const type = getStringField(sessionMessage, "type") ?? "unknown";
  const status = getStringField(record, "status");
  return `${type}${status ? ` (${status})` : ""}: ${text}`;
}

async function waitForGate(
  gate: Promise<void>,
  input: { label: string; timeoutMs: number; describeState: () => string },
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out after ${input.timeoutMs}ms waiting for ${input.label}.\n${input.describeState()}`,
        ),
      );
    }, input.timeoutMs);
  });
  try {
    await Promise.race([gate, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

export async function delayBrowserAgentCreatedStatus(
  page: Page,
): Promise<AgentCreatedDelayControl> {
  const daemonPortPattern = daemonWsRoutePattern();
  const createRequestIds = new Set<string>();
  const delayedForwards: Array<() => void> = [];
  const requestTypes = new Set<string>();
  const daemonErrors: string[] = [];
  let releaseRequested = false;
  let resolveCreateRequest: (() => void) | null = null;
  let resolveDelayedCreatedStatus: (() => void) | null = null;
  let failGates: ((error: Error) => void) | null = null;
  const createRequestSeen = new Promise<void>((resolve) => {
    resolveCreateRequest = resolve;
  });
  const delayedCreatedStatusSeen = new Promise<void>((resolve) => {
    resolveDelayedCreatedStatus = resolve;
  });
  // Raced by both gates so a refused creation fails them at once instead of
  // waiting out the ceiling. Pre-caught: nothing consumes it when the spec has
  // already moved past the gate, and an unobserved rejection would take the
  // whole run down.
  const gateFailed = new Promise<never>((_, reject) => {
    failGates = reject;
  });
  gateFailed.catch(() => {});

  const describeState = () => {
    const requests = requestTypes.size > 0 ? [...requestTypes].join(", ") : "(none)";
    const errors =
      daemonErrors.length > 0
        ? daemonErrors.map((error) => `  - ${error}`).join("\n")
        : "  (none - the daemon reported no error, so look upstream in the app)";
    return `Requests the app sent: ${requests}\nErrors the daemon returned:\n${errors}`;
  };

  await page.routeWebSocket(daemonPortPattern, (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const sessionMessage = getSessionMessage(message);
      const type = sessionMessage ? getStringField(sessionMessage, "type") : null;
      if (type && requestTypes.size < MAX_RECORDED_REQUEST_TYPES) {
        requestTypes.add(type);
      }
      if (sessionMessage?.type === "create_agent_request") {
        const requestId = getStringField(sessionMessage, "requestId");
        if (requestId) {
          createRequestIds.add(requestId);
          resolveCreateRequest?.();
        }
      }
      server.send(message);
    });

    server.onMessage((message) => {
      const sessionMessage = getSessionMessage(message);
      if (sessionMessage) {
        const daemonError = extractDaemonError(sessionMessage);
        if (daemonError && daemonErrors.length < MAX_RECORDED_GATE_ERRORS) {
          daemonErrors.push(daemonError);
        }
      }
      const payload =
        sessionMessage?.type === "status" && typeof sessionMessage.payload === "object"
          ? (sessionMessage.payload as Record<string, unknown>)
          : null;
      const requestId = payload ? getStringField(payload, "requestId") : null;

      if (
        payload?.status === "agent_create_failed" &&
        requestId &&
        createRequestIds.has(requestId)
      ) {
        failGates?.(
          new Error(
            `The daemon refused to create the agent: ${
              getStringField(payload, "error") ?? "no error text"
            }`,
          ),
        );
        ws.send(message);
        return;
      }

      if (payload?.status === "agent_created" && requestId && createRequestIds.has(requestId)) {
        resolveDelayedCreatedStatus?.();
        if (releaseRequested) {
          ws.send(message);
          return;
        }
        delayedForwards.push(() => ws.send(message));
        return;
      }

      ws.send(message);
    });
  });

  return {
    release() {
      releaseRequested = true;
      for (const forward of delayedForwards.splice(0)) {
        forward();
      }
    },
    waitForCreateRequest: (timeoutMs = AGENT_CREATED_GATE_TIMEOUT_MS) =>
      waitForGate(Promise.race([createRequestSeen, gateFailed]), {
        label: "the app to send create_agent_request",
        timeoutMs,
        describeState,
      }),
    waitForDelayedCreatedStatus: (timeoutMs = AGENT_CREATED_GATE_TIMEOUT_MS) =>
      waitForGate(Promise.race([delayedCreatedStatusSeen, gateFailed]), {
        label: "the daemon to answer with the agent_created status",
        timeoutMs,
        describeState,
      }),
  };
}
