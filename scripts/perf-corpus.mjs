// The performance-test conversation corpus: many projects, each with several
// workspaces, each holding a dozen long chats.
//
// Imported by BOTH callers — scripts/seed-perf-corpus.mjs (the dev-daemon corpus
// you can open by hand) and the Playwright soak. That sharing is the point, the
// same way playbook-projects.mjs shares the boilerplate-project corpus: a number
// measured by the soak has to describe the state a human just clicked through,
// or the number stops being evidence about the app the human is complaining about.
//
// This module is transport-free. It takes an already-connected daemon client and
// project roots that already exist on disk, and does nothing but orchestrate. The
// dev script and the E2E suite reach the daemon by different routes and create
// their project directories with different lifetimes; neither difference belongs
// in the seeding logic.
//
// What it builds, per project:
//   - workspace 0 from the project directory itself
//   - workspaces 1..N-1 as Otto worktrees branched off it, which is how a real
//     user ends up with several workspaces under one project
//   - `chatsPerWorkspace` mock agents per workspace, each driven through
//     `turnsPerChat` prompts of `itemsPerTurn` synthetic timeline items
//
// Why many small turns rather than one big one: the app decides how much history
// to keep mounted by walking back from the tail to the nearest user message
// (findMountedWindowStart). The mock provider emits no user event of its own, so
// one 300-item turn contains no user message, the walk runs to index 0, and the
// entire transcript mounts. A corpus built that way would defeat the very
// windowing it exists to exercise. Each prompt contributes a real user message,
// so ten 30-item turns give a 300-item chat with ten window boundaries in it.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const MODEL_ID = "synthetic-history";
const PROVIDER_ID = "mock";
const MODE_ID = "load-test";

/**
 * Changed files written into every workspace so its working tree is dirty.
 *
 * A clean corpus makes the Changes view free, and the Changes view is not a
 * bystander in the case this corpus exists to measure: switching workspaces with
 * the explorer open loads a git status and a diff per switch, which is real work
 * a clean tree never asks for. Seeding chats against pristine repos would leave
 * that cost out of every number and understate the switch.
 */
const DIRTY_FILES_PER_WORKSPACE = 8;

/**
 * 6 projects x 4 workspaces x 12 chats x (10 turns x 30 items) = 288 chats and
 * ~86k timeline items.
 *
 * Chosen to sit above every retention cap it is meant to exercise rather than at
 * a round number: the workspace deck defaults to 5 mounted workspaces and the
 * agent-stream buffers cap at 12 agents, so 24 workspaces and 12 chats per
 * workspace put both eviction paths under real pressure instead of measuring a
 * cap that was never reached.
 */
export const DEFAULT_CORPUS_SCALE = {
  projects: 6,
  workspacesPerProject: 4,
  chatsPerWorkspace: 12,
  turnsPerChat: 10,
  itemsPerTurn: 30,
};

/** Deliberately small so a soak can seed a corpus without a coffee break. */
export const SMOKE_CORPUS_SCALE = {
  projects: 1,
  workspacesPerProject: 1,
  chatsPerWorkspace: 1,
  turnsPerChat: 2,
  itemsPerTurn: 10,
};

// Same generator the server-side conversation builder uses. Duplicated rather
// than imported because this is a .mjs script and that one is TypeScript behind
// a build step; the alternative is making the seeder depend on a compiled
// artifact just to vary a prompt string.
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length)];
}

// A stable 32-bit seed for one turn's coordinates. Every turn in the corpus gets
// its own, derived only from where it sits, so re-seeding the same scale with the
// same corpus seed reproduces the same conversations byte for byte.
function deriveSeed(corpusSeed, projectIndex, workspaceIndex, chatIndex, turnIndex) {
  let hash = corpusSeed >>> 0;
  for (const part of [projectIndex, workspaceIndex, chatIndex, turnIndex]) {
    hash = (Math.imul(hash ^ (part + 0x9e3779b9), 0x85ebca6b) ^ (hash >>> 13)) >>> 0;
  }
  return hash >>> 0;
}

const REQUEST_OPENERS = [
  "Can you take a look at",
  "Something is off in",
  "I need help refactoring",
  "Walk me through",
  "Why does",
  "Please add tests for",
  "Review the error handling in",
  "Trace what happens when",
];

const REQUEST_SUBJECTS = [
  "the session reducer",
  "the workspace deck",
  "the timeline pagination path",
  "the retry logic in the daemon client",
  "the diff gutter renderer",
  "the terminal resize handler",
  "the permission prompt queue",
  "the markdown block cache",
];

const REQUEST_TAILS = [
  "it regressed after the last merge.",
  "I think we are holding a reference we should not be.",
  "the behavior differs between web and desktop.",
  "it only shows up once the transcript gets long.",
  "there is no coverage for the failure branch.",
  "the numbers do not line up with what the UI reports.",
];

// User messages are composed rather than picked for the same reason the assistant
// content is: the app caches rendered markdown block heights keyed by block text,
// so a corpus of repeated prompts would hit that cache on nearly every user bubble
// and report the transcript as cheaper to render than a real one.
function composeUserPrompt(rng, itemCount, seed) {
  const text = `${pick(rng, REQUEST_OPENERS)} ${pick(rng, REQUEST_SUBJECTS)}? ${pick(rng, REQUEST_TAILS)}`;
  // The two directives are what make this a corpus turn rather than an ordinary
  // mock turn: the count bounds it, the seed pins its content.
  return `${text}\n\nsynthetic-history: ${itemCount}\nsynthetic-seed: ${seed}`;
}

/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * Turns within one chat are necessarily serial — the mock provider refuses a
 * second turn while one is active — so all the available parallelism is across
 * chats, and that is where this is applied.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = Array.from({ length: items.length });
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// The agent directory is paged and `page.limit` is capped at 200 by the protocol,
// so an unpaged fetch silently truncates. At corpus scale that is not a rounding
// error: 288 chats come back as 200, the workspaces past the cut look empty, and
// the next run re-seeds them. Adoption has to see every agent or it is worse than
// no adoption at all.
const AGENT_PAGE_LIMIT = 200;

async function fetchAllAgents(client) {
  const agents = [];
  let cursor;
  for (;;) {
    const page = await client
      .fetchAgents({ page: { limit: AGENT_PAGE_LIMIT, ...(cursor ? { cursor } : {}) } })
      .catch(() => null);
    if (!page) {
      return agents;
    }
    for (const entry of page.entries ?? []) {
      if (entry?.agent) {
        agents.push(entry.agent);
      }
    }
    cursor = page.pageInfo?.nextCursor ?? null;
    if (!page.pageInfo?.hasMore || !cursor) {
      return agents;
    }
  }
}

/**
 * Leaves `count` modified and added files in a workspace's working tree.
 *
 * Deterministic from `seed`, like everything else here, so a rebuilt corpus
 * produces the same diff. Both kinds matter: a modified tracked file exercises
 * the diff renderer, an untracked one exercises status only, and a Changes view
 * that only ever sees one of them is not the view a user is looking at.
 */
function dirtyWorkspaceTree(directory, seed, count = DIRTY_FILES_PER_WORKSPACE) {
  if (!directory || !existsSync(directory)) {
    return 0;
  }
  const rng = mulberry32(seed);
  const srcDir = path.join(directory, "src");
  mkdirSync(srcDir, { recursive: true });

  let written = 0;
  for (let index = 0; index < count; index += 1) {
    // Alternating, and each half indexed by its own counter so two writes never
    // land on the same file — otherwise the reported count exceeds the number of
    // files git actually reports as changed.
    const isModification = index % 2 === 0;
    const target = isModification
      ? path.join(srcDir, `module-${Math.floor(index / 2) % 6}.ts`)
      : path.join(srcDir, `scratch-${index}.ts`);
    const lines = 20 + Math.floor(rng() * 60);
    const body = Array.from(
      { length: lines },
      (_unused, line) => `  // ${makeToken(rng)} ${line}: ${makeToken(rng)}`,
    ).join("\n");
    try {
      writeFileSync(target, `export function edit${index}(): void {\n${body}\n}\n`);
      written += 1;
    } catch {
      // A workspace directory that vanished under us is not worth failing the
      // whole corpus for; the count reported back stays honest.
    }
  }
  return written;
}

function makeToken(rng) {
  const parts = ["alpha", "beta", "gamma", "delta", "sigma", "omega", "kappa", "theta"];
  return `${pick(rng, parts)}_${Math.floor(rng() * 100000).toString(36)}`;
}

/**
 * Whether this agent's timeline still holds anything.
 *
 * One row is enough to answer it, so the fetch asks for one. A missing or errored
 * response counts as empty: treating "could not tell" as populated is how a hollow
 * corpus gets adopted and reported as complete.
 */
async function agentHasMessages(client, agentId) {
  try {
    const page = await client.fetchAgentTimeline(agentId, { limit: 1 });
    return (page?.entries?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// Windows hands back mixed separators and mixed case for the same directory, so
// two spellings of one path must not read as two projects.
function samePath(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  const normalize = (value) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

/**
 * Creates one project's workspaces: the directory itself, then worktrees branched
 * off it until `workspacesPerProject` is reached.
 *
 * Reuse-aware on purpose. The daemon refuses to back one directory with a second
 * workspace, so a plain create would turn every re-run into a hard failure on the
 * first project. Seeding is additive instead: adopt whatever this corpus already
 * has and create only the shortfall, which is also what makes "raise the chat
 * count and run it again" work without tearing the corpus down.
 *
 * A worktree that fails to cut is reported and skipped rather than thrown: on a
 * partially seeded corpus the useful outcome is a smaller corpus plus an honest
 * count, not losing the projects that did succeed.
 */
async function seedProjectWorkspaces({ client, project, projectIndex, scale, onProgress }) {
  const existing = await client.fetchWorkspaces();
  const adopted = (existing?.entries ?? []).filter(
    (entry) =>
      samePath(entry.projectRootPath, project.rootPath) ||
      samePath(entry.workspaceDirectory, project.rootPath),
  );

  let root = adopted.find((entry) => samePath(entry.workspaceDirectory, project.rootPath));
  if (!root) {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: project.rootPath },
      title: `${project.label} main`,
    });
    if (!created.workspace) {
      throw new Error(created.error ?? `Failed to open project ${project.rootPath}`);
    }
    root = created.workspace;
  }

  const projectId = root.projectId;
  // Everything already under this project, root first, deduped by workspace id.
  const workspaces = [root];
  for (const sibling of (existing?.entries ?? []).filter(
    (entry) => entry.projectId === projectId,
  )) {
    if (!workspaces.some((workspace) => workspace.id === sibling.id)) {
      workspaces.push(sibling);
    }
  }
  if (workspaces.length >= scale.workspacesPerProject) {
    return { projectId, workspaces: workspaces.slice(0, scale.workspacesPerProject) };
  }

  const slug = slugify(project.label) || `p${projectIndex}`;

  for (let index = workspaces.length; index < scale.workspacesPerProject; index += 1) {
    // No refName: for "branch-off" that field is the BASE to cut from, and
    // omitting it takes the repository default. The new branch name comes from
    // worktreeSlug.
    const worktree = await client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: project.rootPath,
        projectId,
        action: "branch-off",
        worktreeSlug: `${slug}-ws${index}`,
      },
      title: `${project.label} ws${index}`,
    });
    if (!worktree.workspace) {
      onProgress?.({
        phase: "workspace",
        level: "warn",
        detail: `worktree ${slug}-ws${index} failed: ${worktree.error ?? "unknown error"}`,
      });
      continue;
    }
    workspaces.push(worktree.workspace);
  }

  return { projectId, workspaces };
}

/**
 * Drives one chat to its full length: create the agent, then send `turnsPerChat`
 * prompts, waiting for each to finish before the next.
 */
async function seedChat({ client, coords, scale, corpusSeed, turnTimeoutMs, onProgress }) {
  const { workspace, projectIndex, workspaceIndex, chatIndex } = coords;
  const agent = await client.createAgent({
    provider: PROVIDER_ID,
    modeId: MODE_ID,
    model: MODEL_ID,
    cwd: workspace.workspaceDirectory,
    workspaceId: workspace.id,
    title: `Perf chat ${chatIndex + 1}`,
  });

  for (let turnIndex = 0; turnIndex < scale.turnsPerChat; turnIndex += 1) {
    const seed = deriveSeed(corpusSeed, projectIndex, workspaceIndex, chatIndex, turnIndex);
    const rng = mulberry32(seed);
    await client.sendAgentMessage(agent.id, composeUserPrompt(rng, scale.itemsPerTurn, seed));
    const finished = await client.waitForFinish(agent.id, turnTimeoutMs);
    const failure = finished?.final?.lastError;
    if (failure) {
      throw new Error(`Chat ${agent.id} turn ${turnIndex + 1} failed: ${failure}`);
    }
    onProgress?.({ phase: "turn", detail: agent.id });
  }

  return { agentId: agent.id, workspaceId: workspace.id, turns: scale.turnsPerChat };
}

/**
 * Builds the whole corpus against `client`.
 *
 * `projects` is a list of `{ rootPath, label }` that already exist on disk as git
 * repos. Returns the corpus descriptor plus the totals actually achieved, which
 * is not always what was asked for: a worktree that could not be cut lowers the
 * workspace count, and the caller should report the real number rather than the
 * requested one.
 */
export async function seedPerfCorpus({
  client,
  projects,
  scale = DEFAULT_CORPUS_SCALE,
  concurrency = 6,
  corpusSeed = 1,
  turnTimeoutMs = 120_000,
  dirtyFilesPerWorkspace = DIRTY_FILES_PER_WORKSPACE,
  onProgress,
}) {
  const startedAt = Date.now();
  const seeded = [];
  let chatsCreated = 0;
  let dirtyFilesWritten = 0;

  // Chats this corpus already has, by workspace. Without this every re-run
  // silently doubles the chat count, so "the corpus" would mean something
  // different on every invocation and no two measurements would be comparable.
  //
  // **A chat only counts as adopted if it still HAS messages.** Agent timelines
  // live in daemon memory and are not restored on restart (`seedAgentTimeline`
  // has no production caller), so every chat in a corpus goes empty the moment
  // the daemon is bounced, while the agent records survive on disk. Counting
  // agents instead of content therefore adopts a corpus of empty chats and
  // reports it as fully seeded -- which is exactly what happened once, and the
  // resulting "86,400 items" was measured against nothing. Verifying costs one
  // timeline fetch per agent and is the only thing standing between a re-run and
  // a silently hollow corpus.
  const adoptedByWorkspace = new Map();
  let emptyChatsFound = 0;
  for (const agent of await fetchAllAgents(client)) {
    if (agent?.model !== MODEL_ID || !agent.workspaceId) {
      continue;
    }
    if (!(await agentHasMessages(client, agent.id))) {
      emptyChatsFound += 1;
      continue;
    }
    const bucket = adoptedByWorkspace.get(agent.workspaceId) ?? [];
    bucket.push(agent.id);
    adoptedByWorkspace.set(agent.workspaceId, bucket);
  }
  if (emptyChatsFound > 0) {
    onProgress?.({
      phase: "chat",
      level: "warn",
      detail:
        `${emptyChatsFound} existing chat(s) have no messages and were not adopted ` +
        `(a daemon restart empties timelines). They are left in place; use --clean for a true reset.`,
    });
  }

  for (const [projectIndex, project] of projects.entries()) {
    const { projectId, workspaces } = await seedProjectWorkspaces({
      client,
      project,
      projectIndex,
      scale,
      onProgress,
    });
    // Dirty every workspace tree before the chats go in, so the Changes view has
    // real work on the very first switch rather than only after something edits
    // a file. Re-running is safe: the same seed rewrites the same content.
    if (dirtyFilesPerWorkspace > 0) {
      for (const [workspaceIndex, workspace] of workspaces.entries()) {
        dirtyFilesWritten += dirtyWorkspaceTree(
          workspace.workspaceDirectory,
          deriveSeed(corpusSeed, projectIndex, workspaceIndex, 0, 0),
          dirtyFilesPerWorkspace,
        );
      }
    }

    onProgress?.({
      phase: "project",
      detail: `${project.label}: ${workspaces.length} workspaces`,
      done: projectIndex + 1,
      total: projects.length,
    });

    // Every chat still missing from this project, flattened, so the concurrency
    // pool is filled across workspaces too. Filling it per workspace would
    // serialize on the last few chats of each one for no reason. Chat indices
    // start past whatever the workspace already holds, so the seeds of adopted
    // chats are never reused for new ones.
    const chatCoords = workspaces.flatMap((workspace, workspaceIndex) => {
      const already = adoptedByWorkspace.get(workspace.id)?.length ?? 0;
      return Array.from(
        { length: Math.max(0, scale.chatsPerWorkspace - already) },
        (_unused, offset) => ({
          workspace,
          projectIndex,
          workspaceIndex,
          chatIndex: already + offset,
        }),
      );
    });

    let completed = 0;
    const chats = await mapWithConcurrency(chatCoords, concurrency, async (coords) => {
      const chat = await seedChat({
        client,
        coords,
        scale,
        corpusSeed,
        turnTimeoutMs,
        onProgress,
      });
      completed += 1;
      chatsCreated += 1;
      onProgress?.({
        phase: "chat",
        detail: project.label,
        done: completed,
        total: chatCoords.length,
      });
      return chat;
    });

    seeded.push({
      projectId,
      label: project.label,
      rootPath: project.rootPath,
      workspaces: workspaces.map((workspace) => ({
        workspaceId: workspace.id,
        name: workspace.name,
        directory: workspace.workspaceDirectory,
        agentIds: [
          ...(adoptedByWorkspace.get(workspace.id) ?? []),
          ...chats.filter((chat) => chat.workspaceId === workspace.id).map((chat) => chat.agentId),
        ],
      })),
    });
  }

  const workspaceCount = seeded.reduce((sum, project) => sum + project.workspaces.length, 0);
  const chatCount = seeded.reduce(
    (sum, project) =>
      sum + project.workspaces.reduce((inner, workspace) => inner + workspace.agentIds.length, 0),
    0,
  );

  // `chats` is the size of the corpus; `chatsCreated` is what this run paid for.
  // They differ on every re-run, and collapsing them into one number is how a
  // seeder starts reporting turns it never drove.
  return {
    projects: seeded,
    totals: {
      projects: seeded.length,
      workspaces: workspaceCount,
      chats: chatCount,
      chatsCreated,
      chatsAdopted: chatCount - chatsCreated,
      dirtyFilesWritten,
      turnsDriven: chatsCreated * scale.turnsPerChat,
      itemsCreated: chatsCreated * scale.turnsPerChat * scale.itemsPerTurn,
      items: chatCount * scale.turnsPerChat * scale.itemsPerTurn,
    },
    scale,
    corpusSeed,
    elapsedMs: Date.now() - startedAt,
  };
}

/** Reads a scale override off the environment, falling back to `base`. */
export function scaleFromEnv(env, base = DEFAULT_CORPUS_SCALE) {
  const read = (name, fallback) => {
    const raw = env[name];
    if (raw == null || raw === "") {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive number, got "${raw}"`);
    }
    return Math.floor(value);
  };
  return {
    projects: read("OTTO_CORPUS_PROJECTS", base.projects),
    workspacesPerProject: read("OTTO_CORPUS_WORKSPACES", base.workspacesPerProject),
    chatsPerWorkspace: read("OTTO_CORPUS_CHATS", base.chatsPerWorkspace),
    turnsPerChat: read("OTTO_CORPUS_TURNS", base.turnsPerChat),
    itemsPerTurn: read("OTTO_CORPUS_ITEMS", base.itemsPerTurn),
  };
}
