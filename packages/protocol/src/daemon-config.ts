import { z } from "zod";
import { AgentPersonalitySchema, AgentTeamSchema } from "./personality-schemas.js";
import { STALL_GUARD_DEFAULT_THRESHOLD, STALL_GUARD_MAX_THRESHOLD } from "./provider-config.js";

/**
 * Otto's mutable daemon-config fragments: the per-feature config sections Paseo's MutableDaemonConfigSchema composes. Each Otto feature registers one field there; the section schema lives here.
 */

// Daemon-wide agent behavior toggles. Each maps to a Claude-tier capability;
// providers that can't honor a setting silently ignore it (WP-E wires the
// reads). All default true so a fresh host behaves exactly like today.
export const MutableAgentBehaviorsConfigSchema = z
  .object({
    // Native next-prompt predictions (Claude prompt_suggestion stream events).
    promptSuggestions: z.boolean().default(true),
    // Agent-authored progress summaries emitted during a turn.
    agentProgressSummaries: z.boolean().default(true),
    // Default value of an agent's notifyOnFinish when the spawn path leaves it
    // unspecified (the current implicit default).
    notifyOnFinishDefault: z.boolean().default(true),
    // Provider-agnostic task-list reminders. Otto renders every provider's
    // native todo list into one timeline UI; when an agent leaves that list with
    // unfinished items, these keep it from going stale (the user shouldn't have
    // to dismiss a half-checked list themselves).
    // Passive: while a stale list is open, attach a reminder to the agent's next
    // turn (mirrors the harness's own "your todo list looks stale" nudge).
    todoNudge: z.boolean().default(true),
    // Active: when the agent goes idle with a stale list, inject a one-shot
    // reconcile pass so it marks done what's done (or states what's genuinely
    // left) before the turn truly ends.
    todoReconcileOnIdle: z.boolean().default(true),
    // Provider-agnostic tool-emission stall guard: consecutive assistant
    // messages that neither call a tool nor hand back to the user before the
    // daemon interrupts the run. A tool call or a real user prompt resets the
    // count, so working loops and ordinary chat never trip it. 0 disables.
    // See STALL_GUARD_* in provider-config.ts and agent-stall-guard.ts.
    stallGuardThreshold: z
      .number()
      .int()
      .min(0)
      .max(STALL_GUARD_MAX_THRESHOLD)
      .default(STALL_GUARD_DEFAULT_THRESHOLD),
  })
  .passthrough();

/**
 * Language-server code intelligence, host-scoped because the servers are processes
 * on the daemon's machine - they follow the host, not the client.
 *
 * `enabled` defaults **on** and that is safe: nothing spawns until a
 * code-intelligence action needs a language in a workspace, so an unused language
 * costs nothing. What the switch guarantees is that off means off - no server
 * spawns for any workspace, and the ctags index still serves the outline and the
 * fuzzy finder.
 *
 * `languages` keys are registry row ids (`typescript`, `python`, `csharp`, …). An
 * absent key means "use the row's own default", so a new row ships with its
 * intended default rather than reading as disabled.
 */
export const MutableLspConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    languages: z.record(z.string(), z.boolean()).default({}),
    /**
     * How much of a .NET workspace the C# server loads.
     *
     * `"solution"` names the workspace root's single solution with `csharp-ls -s`. `"allProjects"`
     * passes nothing, leaving csharp-ls to glob every `.csproj` under the root - complete coverage,
     * but it loads them one at a time (measured at ~4s each, so a 200-project repo is minutes, not
     * seconds). Absent means `"solution"`.
     *
     * Deliberately carries NO `.default()`. The patch schema is `MutableLspConfigSchema.partial()`,
     * and Zod keeps defaults through `.partial()`, so a default here would be injected into every
     * unrelated `lsp` patch and deep-merge would silently reset the user's choice.
     */
    csharpProjectScope: z.enum(["solution", "allProjects"]).optional(),
    /** Hard LRU cap on simultaneously running servers, across all workspaces. */
    maxRunningServers: z.number().int().positive().default(6),
    idleMinutes: z.number().int().positive().default(10),
    /** Shorter allowance for workspaces the user is not currently looking at. */
    backgroundIdleMinutes: z.number().int().positive().default(2),
  })
  .passthrough();

/**
 * "Microsoft .NET Solution Management" - the Solution view's own switch.
 *
 * **A sibling of `lsp`, not a member of it.** Turning C# code intelligence off does not turn
 * this off and vice versa: they are independent capabilities that happen to share a language,
 * and nesting this inside the LSP settings object would imply exactly the coupling that
 * decision rejects. (It would also be wrong on the facts - LSP has no project-structure
 * request, so nothing here rides on a language server.)
 *
 * Defaults **off**: the feature spawns a process and evaluates MSBuild. Disabled is genuinely
 * off, not merely hidden - no discovery walk, no `.sln` read, no `.csproj` parse, no sidecar,
 * no cache, no watcher, and no view switcher. The daemon reads this before scheduling any work,
 * so a disabled feature costs exactly one boolean check.
 */
export const MutableDotnetSolutionConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Hard cap on simultaneously running sidecars, across all workspaces. */
    maxRunningProbes: z.number().int().positive().default(2),
    idleMinutes: z.number().int().positive().default(10),
  })
  .passthrough();

// Host-level git hosting credentials, one set per provider. A workspace's
// provider is derived from its git remote (bitbucket.org → Bitbucket,
// github.com → GitHub), so credentials are configured once per host, not per
// project. Keys persist to $OTTO_HOME/config.json and are echoed in
// get_daemon_config_response the same way provider connection keys are.
export const MutableGitHostingBitbucketCloudConfigSchema = z
  .object({
    // Atlassian account email + API token, sent as HTTP Basic auth.
    email: z.string().optional(),
    apiToken: z.string().optional(),
  })
  .passthrough();

// The one Atlassian account credential, shared by every Atlassian surface:
// Bitbucket Cloud for git hosting and Jira for the Kanban board. Both are HTTP
// Basic (account email + API token), so there is one credential to author and
// one place it can go stale. `atlassian` supersedes `bitbucketCloud`; the
// daemon reads this first and falls back to the older key.
// COMPAT(atlassianCredential): added in v0.8.11, drop the bitbucketCloud
// fallback after 2027-02-28.
export const MutableGitHostingAtlassianConfigSchema = z
  .object({
    email: z.string().optional(),
    apiToken: z.string().optional(),
    // Jira Cloud site base URL, e.g. https://acme.atlassian.net. Not a secret.
    // Required for Jira: Basic-auth Jira Cloud calls are site-addressed, unlike
    // the OAuth-only api.atlassian.com/ex/jira gateway.
    jiraSiteUrl: z.string().optional(),
  })
  .passthrough();

export const MutableGitHostingProvidersConfigSchema = z
  .object({
    bitbucketCloud: MutableGitHostingBitbucketCloudConfigSchema.optional(),
    atlassian: MutableGitHostingAtlassianConfigSchema.optional(),
  })
  .passthrough();

export const MutableGitHostingConfigSchema = z
  .object({
    providers: MutableGitHostingProvidersConfigSchema.optional(),
  })
  .passthrough();

export type MutableGitHostingConfig = z.infer<typeof MutableGitHostingConfigSchema>;

// RETIRED: the Kanban board surface no longer has credentials of its own. It
// reuses the host's existing authentication - GitHub through the `gh` CLI, Jira
// through the shared Atlassian credential above. Nothing reads these fields any
// more and the settings UI never wrote them, but the schema stays so existing
// $OTTO_HOME/config.json files and older clients keep parsing (removed fields
// stay accepted; we only stop sending them). They remain masked via
// SECRET_WIRE_PATHS so a hand-edited token is never echoed back in the clear.
// COMPAT(kanbanProviderTokens): retired in v0.8.11, delete after 2027-02-28.
export const MutableKanbanConfigSchema = z
  .object({
    providers: z
      .object({
        github: z
          .object({
            // Fine-grained or classic PAT with `projects: read`. Empty string
            // = not configured.
            token: z.string().optional(),
          })
          .passthrough(),
        jira: z
          .object({
            // Jira Cloud API token (site-wide token or PAT). Empty string =
            // not configured.
            token: z.string().optional(),
          })
          .passthrough(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type MutableKanbanConfig = z.infer<typeof MutableKanbanConfigSchema>;

export const MutableAgentPersonalitiesConfigSchema = z
  .object({
    personalities: z.array(AgentPersonalitySchema).default([]),
  })
  .passthrough();

// Patch shape declared explicitly rather than via .partial(): partial() keeps
// the personalities .default([]), so a patch touching the section without an
// explicit personalities array would have an empty array injected and
// deep-merge would wipe the stored roster.
export const MutableAgentPersonalitiesConfigPatchSchema = z
  .object({
    personalities: z.array(AgentPersonalitySchema).optional(),
  })
  .passthrough();

export const MutableAgentTeamsConfigSchema = z
  .object({
    teams: z.array(AgentTeamSchema).default([]),
    // The host's active team id; null/absent = no team active (exactly legacy
    // behavior). Host-scoped daemon config rather than device-local: the team
    // prompt is applied daemon-side at spawn, so headless spawns (MCP
    // create_agent, schedule runs) must see it, and a patch from any client
    // hot-reloads the switch to every connected client.
    activeTeamId: z.string().nullable().optional(),
  })
  .passthrough();

// Patch shape declared explicitly rather than via .partial(): partial() keeps
// the teams .default([]), so a patch that only touches activeTeamId would have
// an empty array injected and deep-merge would wipe the stored teams.
export const MutableAgentTeamsConfigPatchSchema = z
  .object({
    teams: z.array(AgentTeamSchema).optional(),
    activeTeamId: z.string().nullable().optional(),
  })
  .passthrough();

// The editable projection of @otto-code/brain's own config (the brain's
// config.json stays the source of truth on disk; the daemon writes changes
// through). Every field is defaulted so a new client parsing an old daemon's
// config sees a well-formed, OFF section.
export const MutableBrainTlsConfigSchema = z
  .object({
    mode: z.enum(["off", "files", "self-signed", "tailscale"]).default("off"),
    certFile: z.string().nullable().default(null),
    keyFile: z.string().nullable().default(null),
    hostname: z.string().nullable().default(null),
    certDir: z.string().nullable().default(null),
    renewBeforeDays: z.number().int().min(1).default(21),
  })
  .passthrough();

// Where a remote brain lives, when brain.mode is "remote". Every field is
// defaulted so an old daemon's config parses as a well-formed, empty target.
export const MutableBrainRemoteConfigSchema = z
  .object({
    host: z.string().default(""),
    port: z.number().int().default(1234),
    secure: z.boolean().default(false),
    // Secret: masked with DAEMON_CONFIG_SECRET_SENTINEL on the way out.
    authToken: z.string().nullable().default(null),
    // SHA-256 fingerprint of the remote brain's TLS certificate (openssl's
    // "AB:CD:..." form; colons optional). When set, the daemon pins HTTPS
    // connections to exactly this certificate instead of the system trust
    // store - required for a brain serving tls.mode=self-signed. When null,
    // the certificate must validate against the system trust store.
    certFingerprint: z.string().nullable().default(null),
  })
  .passthrough();

export const MutableBrainConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    autoStart: z.boolean().default(false),
    // "local": the daemon spawns and supervises the brain on this host.
    // "remote": the daemon connects to a brain running on another Otto host
    // (read-only: status/evals/config, no lifecycle). Gated by features.brainRemote.
    mode: z.enum(["local", "remote"]).default("local"),
    remote: MutableBrainRemoteConfigSchema.default({
      host: "",
      port: 1234,
      secure: false,
      authToken: null,
      certFingerprint: null,
    }),
    listen: z
      .object({
        host: z.string().default("127.0.0.1"),
        port: z.number().int().default(1234),
      })
      .passthrough()
      .default({ host: "127.0.0.1", port: 1234 }),
    defaultModel: z.string().nullable().default(null),
    maxLoadedModels: z.number().int().min(1).max(16).default(1),
    lockedModels: z.array(z.string()).default([]),
    runtime: z
      .object({
        source: z.enum(["auto", "managed", "lmstudio"]).default("auto"),
        path: z.string().nullable().default(null),
        logVerbosity: z.number().int().min(0).max(5).default(3),
      })
      .default({ source: "auto", path: null, logVerbosity: 3 }),
    // Pin the host to one model: serve only the default/resident model and
    // refuse completion requests that ask for a different one.
    lockModel: z.boolean().default(false),
    // Sharing gates (off by default). allowRemoteConfig: key holders may CHANGE
    // config over the network (POST /__host/config), not just use it.
    // allowInsecureBind: permit a non-loopback bind with no token (open share).
    allowRemoteConfig: z.boolean().default(false),
    allowInsecureBind: z.boolean().default(false),
    authMode: z.enum(["none", "token"]).default("none"),
    // Secret: masked with DAEMON_CONFIG_SECRET_SENTINEL on the way out; an
    // unchanged sentinel is stripped from inbound patches.
    authToken: z.string().nullable().default(null),
    tls: MutableBrainTlsConfigSchema.default({
      mode: "off",
      certFile: null,
      keyFile: null,
      hostname: null,
      certDir: null,
      renewBeforeDays: 21,
    }),
  })
  .passthrough();

export type MutableBrainConfig = z.infer<typeof MutableBrainConfigSchema>;

// The brain PATCH schema - deliberately NOT `MutableBrainConfigSchema.partial()`.
// Every field of the full schema carries a `.default()` (so an old daemon's
// half-written config still parses as a well-formed OFF section), and Zod keeps
// those defaults through `.partial()`: `MutableBrainConfigSchema.partial().parse(
// { allowRemoteConfig: true })` expands to the FULL object with every other field
// defaulted. The daemon deep-merges the parsed patch over the stored config, so a
// single-field patch would silently reset the entire brain block to defaults -
// turning sharing off (host back to loopback), wiping the auth token, and
// disabling the server. Mirroring the shape WITHOUT defaults keeps an omitted
// field omitted, so the deep-merge preserves it. Every level is deep-partial so a
// nested patch (e.g. just `listen.host`) preserves its siblings too. Keep the
// field set in sync with MutableBrainConfigSchema; `.passthrough()` carries any
// field a newer daemon adds through untouched in the meantime.
export const MutableBrainTlsPatchSchema = z
  .object({
    mode: z.enum(["off", "files", "self-signed", "tailscale"]),
    certFile: z.string().nullable(),
    keyFile: z.string().nullable(),
    hostname: z.string().nullable(),
    certDir: z.string().nullable(),
    renewBeforeDays: z.number().int().min(1),
  })
  .partial()
  .passthrough();

export const MutableBrainRemotePatchSchema = z
  .object({
    host: z.string(),
    port: z.number().int(),
    secure: z.boolean(),
    authToken: z.string().nullable(),
    certFingerprint: z.string().nullable(),
  })
  .partial()
  .passthrough();

export const MutableBrainListenPatchSchema = z
  .object({
    host: z.string(),
    port: z.number().int(),
  })
  .partial()
  .passthrough();

export const MutableBrainConfigPatchSchema = z
  .object({
    enabled: z.boolean(),
    autoStart: z.boolean(),
    mode: z.enum(["local", "remote"]),
    remote: MutableBrainRemotePatchSchema,
    listen: MutableBrainListenPatchSchema,
    defaultModel: z.string().nullable(),
    maxLoadedModels: z.number().int().min(1).max(16),
    lockedModels: z.array(z.string()),
    runtime: z
      .object({
        source: z.enum(["auto", "managed", "lmstudio"]),
        path: z.string().nullable(),
        logVerbosity: z.number().int().min(0).max(5),
      })
      .partial(),
    lockModel: z.boolean(),
    allowRemoteConfig: z.boolean(),
    allowInsecureBind: z.boolean(),
    authMode: z.enum(["none", "token"]),
    authToken: z.string().nullable(),
    tls: MutableBrainTlsPatchSchema,
  })
  .partial()
  .passthrough();

export const DEFAULT_MUTABLE_BRAIN_CONFIG = {
  enabled: false,
  autoStart: false,
  mode: "local" as const,
  remote: { host: "", port: 1234, secure: false, authToken: null, certFingerprint: null },
  listen: { host: "127.0.0.1", port: 1234 },
  defaultModel: null,
  maxLoadedModels: 1,
  lockedModels: [],
  runtime: { source: "auto" as const, path: null, logVerbosity: 3 },
  lockModel: false,
  allowRemoteConfig: false,
  allowInsecureBind: false,
  authMode: "none" as const,
  authToken: null,
  tls: {
    mode: "off" as const,
    certFile: null,
    keyFile: null,
    hostname: null,
    certDir: null,
    renewBeforeDays: 21,
  },
};

export const GIT_FETCH_INTERVAL_SECONDS = [60, 180, 300, 600, 900, 1_800, 3_600] as const;

export const MutableGitFetchConfigSchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.union([
    z.literal(60),
    z.literal(180),
    z.literal(300),
    z.literal(600),
    z.literal(900),
    z.literal(1_800),
    z.literal(3_600),
  ]),
});

export const DEFAULT_MUTABLE_GIT_FETCH_CONFIG = {
  enabled: true,
  intervalSeconds: 180,
};

export type MutableLspConfig = z.infer<typeof MutableLspConfigSchema>;

export type MutableDotnetSolutionConfig = z.infer<typeof MutableDotnetSolutionConfigSchema>;
