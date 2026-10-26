import path from "node:path";
import type {
  ClaudeContextSettings,
  CodexContextSettings,
  OpenCodeContextSettings,
} from "./native-config.js";

export interface NativeContextLocation {
  cwd: string;
  root: string;
  userHome: string;
  managedDirectory: string | null;
  /** Inject the fixture's boundary in tests; production follows native ancestor discovery. */
  ancestorBoundary?: string;
}
export interface NativeLoadPoint {
  candidates: string[];
  category: "context_files" | "memory_index";
  scope: "host" | "project" | "subdirectory";
  label: "Managed" | "Global" | "Project" | "Local";
  gate: "always" | "claude-primary" | "claude-fallback";
  firstNonempty: boolean;
  memoryIndex: boolean;
}
export interface NativeRosterRoot {
  directory: string;
  kind: "skill" | "subagent";
  writable: boolean;
}
export interface NativeContextPlan {
  provider: "claude" | "codex" | "opencode";
  confidence: "convention";
  imports: boolean;
  importDepth: number;
  instructionBytes: number;
  instructionMode: ClaudeContextSettings["instructionMode"];
  loadPoints: NativeLoadPoint[];
  conditionalRoot: string | null;
  conditionalNames: string[];
  rosterRoots: NativeRosterRoot[];
  ruleRoots: { directory: string; conditional: boolean }[];
  configuredInstructions: { pattern: string; directories: string[] }[];
  disabledSkillPaths: string[];
  excludes: string[];
  enabledPlugins: Record<string, boolean>;
  notes: string[];
}
type NativePlanInput = NativeContextLocation &
  (
    | {
        provider: "claude";
        configDirectory: string;
        settings: ClaudeContextSettings;
        memoryDirectory: string;
      }
    | { provider: "codex"; configDirectory: string; settings: CodexContextSettings }
    | {
        provider: "opencode";
        configDirectory: string;
        settings: OpenCodeContextSettings;
        projectConfigDisabled: boolean;
      }
  );

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function ancestors(cwd: string, stop: string): string[] {
  if (!inside(stop, cwd))
    throw new Error("The context working directory is outside its selected root.");
  const result = [cwd];
  for (let current = cwd; current !== stop; ) {
    current = path.dirname(current);
    result.push(current);
    if (result.length > 128)
      throw new Error("The context directory chain exceeds its inspection limit.");
  }
  return result;
}
function point(
  input: NativeContextLocation,
  candidates: string[],
  label: NativeLoadPoint["label"],
  gate: NativeLoadPoint["gate"] = "always",
): NativeLoadPoint {
  const file = candidates[0]!;
  return {
    candidates,
    category: "context_files",
    scope: inside(input.root, file) ? "project" : "host",
    label,
    gate,
    firstNonempty: false,
    memoryIndex: false,
  };
}
function base(provider: NativeContextPlan["provider"]): NativeContextPlan {
  return {
    provider,
    confidence: "convention",
    imports: false,
    importDepth: 0,
    instructionBytes: 1048576,
    instructionMode: null,
    loadPoints: [],
    conditionalRoot: null,
    conditionalNames: [],
    rosterRoots: [],
    ruleRoots: [],
    configuredInstructions: [],
    disabledSkillPaths: [],
    excludes: [],
    enabledPlugins: {},
    notes: [
      "Documented provider discovery, not captured request text. Native presets, bundled skills and actual tool schemas may add input not visible here.",
    ],
  };
}
function claudePlan(input: Extract<NativePlanInput, { provider: "claude" }>): NativeContextPlan {
  const plan = base("claude");
  plan.imports = true;
  plan.importDepth = 4;
  plan.instructionMode = input.settings.instructionMode ?? "claude-md-or-agents-md";
  plan.excludes = input.settings.excludes;
  plan.enabledPlugins = input.settings.enabledPlugins;
  if (input.managedDirectory)
    plan.loadPoints.push(point(input, [path.join(input.managedDirectory, "CLAUDE.md")], "Managed"));
  if (plan.instructionMode !== "managed-only") {
    plan.loadPoints.push(point(input, [path.join(input.configDirectory, "CLAUDE.md")], "Global"));
    const directories = ancestors(
      input.cwd,
      input.ancestorBoundary ?? path.parse(input.cwd).root,
    ).toReversed();
    for (const directory of directories) {
      const label = inside(input.root, directory) ? "Project" : "Global";
      plan.loadPoints.push(
        point(input, [path.join(directory, "CLAUDE.md")], label, "claude-primary"),
      );
      plan.loadPoints.push(
        point(input, [path.join(directory, ".claude", "CLAUDE.md")], label, "claude-primary"),
      );
      plan.loadPoints.push(
        point(input, [path.join(directory, "CLAUDE.local.md")], "Local", "claude-primary"),
      );
      plan.loadPoints.push(
        point(input, [path.join(directory, "AGENTS.md")], label, "claude-fallback"),
      );
      plan.loadPoints.push(
        point(input, [path.join(directory, ".claude", "AGENTS.md")], label, "claude-fallback"),
      );
    }
  }
  if (input.settings.memoryEnabled) {
    plan.loadPoints.push({
      ...point(
        input,
        [
          input.settings.memoryDirectory
            ? path.join(input.settings.memoryDirectory, "MEMORY.md")
            : path.join(input.memoryDirectory, "MEMORY.md"),
        ],
        "Global",
      ),
      category: "memory_index",
      memoryIndex: true,
    });
  }
  plan.conditionalRoot = input.cwd;
  plan.conditionalNames = ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"];
  if (plan.instructionMode !== "claude-md" && plan.instructionMode !== "managed-only")
    plan.conditionalNames.push("AGENTS.md", ".claude/AGENTS.md");
  plan.rosterRoots = [
    { directory: path.join(input.configDirectory, "skills"), kind: "skill", writable: true },
    { directory: path.join(input.root, ".claude", "skills"), kind: "skill", writable: true },
    { directory: path.join(input.configDirectory, "agents"), kind: "subagent", writable: true },
    { directory: path.join(input.root, ".claude", "agents"), kind: "subagent", writable: true },
  ];
  plan.ruleRoots = [
    {
      directory: path.join(input.configDirectory, "rules"),
      conditional: plan.instructionMode === "managed-only",
    },
    ...ancestors(input.cwd, input.ancestorBoundary ?? path.parse(input.cwd).root)
      .toReversed()
      .map((directory) => ({
        directory: path.join(directory, ".claude", "rules"),
        conditional: plan.instructionMode === "managed-only",
      })),
  ];
  plan.notes.push(
    "Claude instruction mode and external-import approval can vary by installed CLI version and managed policy; this is a convention estimate, not proof of loaded content.",
  );
  return plan;
}
function codexPlan(input: Extract<NativePlanInput, { provider: "codex" }>): NativeContextPlan {
  const plan = base("codex");
  plan.instructionBytes = input.settings.maxBytes;
  plan.disabledSkillPaths = input.settings.disabledSkillPaths;
  const global = point(
    input,
    [
      path.join(input.configDirectory, "AGENTS.override.md"),
      path.join(input.configDirectory, "AGENTS.md"),
    ],
    "Global",
  );
  global.firstNonempty = true;
  plan.loadPoints.push(global);
  for (const directory of ancestors(input.cwd, input.root).toReversed()) {
    const names = ["AGENTS.override.md", "AGENTS.md", ...input.settings.fallbackNames];
    const local = point(
      input,
      names.map((name) => path.join(directory, name)),
      "Project",
    );
    local.firstNonempty = true;
    plan.loadPoints.push(local);
  }
  plan.rosterRoots = [
    { directory: path.join(input.userHome, ".agents", "skills"), kind: "skill", writable: true },
    ...ancestors(input.cwd, input.root)
      .toReversed()
      .map(
        (directory): NativeRosterRoot => ({
          directory: path.join(directory, ".agents", "skills"),
          kind: "skill",
          writable: true,
        }),
      ),
  ];
  if (input.managedDirectory)
    plan.rosterRoots.push({
      directory: path.join(input.managedDirectory, "skills"),
      kind: "skill",
      writable: false,
    });
  plan.notes.push(
    "AGENTS imports are not a documented Codex loading mechanism. The configured instruction byte cap applies to the combined chain; conditional instructions are not assumed from filename alone.",
  );
  return plan;
}
function openCodePlan(
  input: Extract<NativePlanInput, { provider: "opencode" }>,
): NativeContextPlan {
  const plan = base("opencode");
  plan.loadPoints.push(point(input, [path.join(input.configDirectory, "AGENTS.md")], "Global"));
  const directories = input.projectConfigDisabled
    ? []
    : ancestors(input.cwd, inside(input.userHome, input.cwd) ? input.userHome : input.root);
  for (const directory of directories)
    plan.loadPoints.push(
      point(
        input,
        [path.join(directory, "AGENTS.md")],
        inside(input.root, directory) ? "Project" : "Global",
      ),
    );
  plan.conditionalRoot = input.projectConfigDisabled ? null : input.cwd;
  plan.conditionalNames = ["AGENTS.md"];
  // V2's ambient AGENTS chain may reach home, but relative configured patterns stop at the project root.
  const instructionDirectories = input.projectConfigDisabled
    ? [input.configDirectory]
    : ancestors(input.cwd, input.root);
  plan.configuredInstructions = input.settings.instructions.map((pattern) => ({
    pattern,
    directories: instructionDirectories,
  }));
  const rosterDirectories = input.projectConfigDisabled
    ? []
    : ancestors(input.cwd, input.root).toReversed();
  const skillPaths = input.settings.skillPaths.filter((directory) => !/^https?:/iu.test(directory));
  if (skillPaths.length !== input.settings.skillPaths.length)
    plan.notes.push(
      "Remote skill catalogs are not fetched by Context inspection; their roster cost is unknown.",
    );
  plan.rosterRoots = [
    { directory: path.join(input.userHome, ".claude", "skills"), kind: "skill", writable: true },
    ...rosterDirectories.map(
      (directory): NativeRosterRoot => ({
        directory: path.join(directory, ".claude", "skills"),
        kind: "skill",
        writable: true,
      }),
    ),
    { directory: path.join(input.userHome, ".agents", "skills"), kind: "skill", writable: true },
    ...rosterDirectories.map(
      (directory): NativeRosterRoot => ({
        directory: path.join(directory, ".agents", "skills"),
        kind: "skill",
        writable: true,
      }),
    ),
    { directory: path.join(input.configDirectory, "skills"), kind: "skill", writable: true },
    ...rosterDirectories.flatMap((directory): NativeRosterRoot[] => [
      { directory: path.join(directory, ".opencode", "skills"), kind: "skill", writable: true },
      { directory: path.join(directory, ".opencode", "agents"), kind: "subagent", writable: true },
    ]),
    ...skillPaths.map(
      (directory): NativeRosterRoot => ({
        directory: path.resolve(
          input.cwd,
          directory.replace(/^~[/\\]/u, input.userHome + path.sep),
        ),
        kind: "skill",
        writable: false,
      }),
    ),
    { directory: path.join(input.configDirectory, "agents"), kind: "subagent", writable: true },
  ];
  if (input.projectConfigDisabled)
    plan.rosterRoots = plan.rosterRoots.filter((entry) => !inside(input.root, entry.directory));
  plan.notes.push(
    "OpenCode roster estimates are an inventory ceiling; selected-agent permissions and relevance can hide advertised skills.",
  );
  plan.notes.push(
    "This host uses the Paseo OpenCode V2 integration: AGENTS.md discovery is nearest-first and does not use CLAUDE.md fallbacks. Configured remote instructions are not fetched by Context inspection.",
  );
  return plan;
}
/** Discovery is provider-specific; it never changes a provider's real prompt or starts its process. */
export function nativeContextPlan(input: NativePlanInput): NativeContextPlan {
  switch (input.provider) {
    case "claude":
      return claudePlan(input);
    case "codex":
      return codexPlan(input);
    case "opencode":
      return openCodePlan(input);
  }
}
