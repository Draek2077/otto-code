import path from "node:path";
import { z } from "zod";
import { claudeProjectDir } from "../../agent/providers/claude/project-dir.js";
import { NativeContextFiles } from "./native-files.js";
import {
  nativeContextPlan,
  type NativeContextLocation,
  type NativeContextPlan,
} from "./native-plan.js";
import { inspectNativeContext } from "./native-inventory.js";
import {
  parseNativeConfig,
  codexContextSettings,
  claudeContextSettings,
  openCodeContextSettings,
  type NativeConfigResult,
} from "./native-config.js";

interface NativeReaderInput extends NativeContextLocation {
  provider: NativeContextPlan["provider"];
  /** Only discovery path/flag fields; no credential projection is retained or returned. */
  environment: Partial<
    Record<
      | "CLAUDE_CONFIG_DIR"
      | "CODEX_HOME"
      | "XDG_CONFIG_HOME"
      | "OPENCODE_CONFIG_DIR"
      | "OPENCODE_DISABLE_PROJECT_CONFIG",
      string
    >
  >;
}
function value<T>(result: NativeConfigResult<T>, fallback: T, files: NativeContextFiles): T {
  if (result.ok) return result.value;
  files.note(result.message + " This inventory may omit configured input.");
  return fallback;
}
async function config(
  files: NativeContextFiles,
  file: string,
  format: "toml" | "jsonc" = "jsonc",
): Promise<unknown> {
  const source = await files.read(file);
  if (!source) return {};
  return value(parseNativeConfig(source.text, format), {}, files);
}
function chain(input: NativeContextLocation): string[] {
  const result = [input.cwd];
  const boundary = input.ancestorBoundary ?? path.parse(input.cwd).root;
  for (let directory = input.cwd; directory !== boundary && result.length < 128; ) {
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
    result.push(directory);
  }
  return result.toReversed();
}
const PluginIndexSchema = z.object({
  plugins: z.record(
    z.string(),
    z.array(
      z.object({
        installPath: z.string(),
        scope: z.enum(["user", "project", "local", "managed"]),
        projectPath: z.string().optional(),
      }),
    ),
  ),
});
async function pluginRosters(
  plan: NativeContextPlan,
  files: NativeContextFiles,
  directory: string,
  root: string,
) {
  if (!Object.values(plan.enabledPlugins).some(Boolean)) return;
  const parsed = PluginIndexSchema.safeParse(
    await config(files, path.join(directory, "plugins", "installed_plugins.json")),
  );
  if (!parsed.success) {
    files.note(
      "Enabled plugin installation identities are unavailable; their roster cost is unknown.",
    );
    return;
  }
  for (const [id, installed] of Object.entries(parsed.data.plugins)) {
    if (!plan.enabledPlugins[id]) continue;
    for (const entry of installed) {
      if (
        entry.scope !== "user" &&
        entry.scope !== "managed" &&
        path.resolve(entry.projectPath ?? "") !== root
      )
        continue;
      if (!path.isAbsolute(entry.installPath)) {
        files.note("A plugin install identity is not an absolute host path.");
        continue;
      }
      plan.rosterRoots.push(
        { directory: path.join(entry.installPath, "skills"), kind: "skill", writable: false },
        { directory: path.join(entry.installPath, "agents"), kind: "subagent", writable: false },
      );
    }
  }
  files.note(
    "Plugin roster discovery follows the recorded installed-plugin identities; cache versions are not guessed by directory enumeration.",
  );
}
async function claude(input: NativeReaderInput, files: NativeContextFiles) {
  const directory = path.resolve(
    input.environment.CLAUDE_CONFIG_DIR ?? path.join(input.userHome, ".claude"),
  );
  const values: unknown[] = [await config(files, path.join(directory, "settings.json"))];
  for (const folder of chain(input)) {
    values.push(
      await config(files, path.join(folder, ".claude", "settings.json")),
      await config(files, path.join(folder, ".claude", "settings.local.json")),
    );
  }
  const managed = input.managedDirectory
    ? await config(files, path.join(input.managedDirectory, "managed-settings.json"))
    : {};
  values.push(managed);
  const settings = value(
    claudeContextSettings(values),
    {
      instructionMode: null,
      memoryEnabled: true,
      memoryDirectory: null,
      excludes: [],
      enabledPlugins: {},
    },
    files,
  );
  const managedMode = claudeContextSettings([managed]);
  if (managedMode.ok && managedMode.value.instructionMode !== null)
    settings.instructionMode = managedMode.value.instructionMode;
  const memoryDirectory = path.join(
    await claudeProjectDir(input.root, { configDir: directory }),
    "memory",
  );
  const plan = nativeContextPlan({
    ...input,
    provider: "claude",
    configDirectory: directory,
    memoryDirectory,
    settings,
  });
  await pluginRosters(plan, files, directory, input.root);
  return { plan, directory };
}
async function codex(input: NativeReaderInput, files: NativeContextFiles) {
  const directory = path.resolve(
    input.environment.CODEX_HOME ?? path.join(input.userHome, ".codex"),
  );
  const settings = value(
    codexContextSettings(await config(files, path.join(directory, "config.toml"), "toml")),
    { fallbackNames: [], maxBytes: 32768, disabledSkillPaths: [] },
    files,
  );
  return {
    directory,
    plan: nativeContextPlan({ ...input, provider: "codex", configDirectory: directory, settings }),
  };
}
async function openCode(input: NativeReaderInput, files: NativeContextFiles) {
  const directory = path.resolve(
    input.environment.OPENCODE_CONFIG_DIR ??
      path.join(
        input.environment.XDG_CONFIG_HOME ?? path.join(input.userHome, ".config"),
        "opencode",
      ),
  );
  const values: unknown[] = [];
  const readPair = async (folder: string) => {
    values.push(
      await config(files, path.join(folder, "opencode.json")),
      await config(files, path.join(folder, "opencode.jsonc")),
    );
  };
  await readPair(directory);
  const projectConfigDisabled =
    input.environment.OPENCODE_DISABLE_PROJECT_CONFIG === "true" ||
    input.environment.OPENCODE_DISABLE_PROJECT_CONFIG === "1";
  if (!projectConfigDisabled) {
    for (const folder of chain(input)) await readPair(folder);
    for (const folder of chain(input)) await readPair(path.join(folder, ".opencode"));
  }
  if (input.managedDirectory) await readPair(input.managedDirectory);
  const settings = value(
    openCodeContextSettings(values),
    { instructions: [], skillPaths: [] },
    files,
  );
  return {
    directory,
    plan: nativeContextPlan({
      ...input,
      provider: "opencode",
      configDirectory: directory,
      projectConfigDisabled,
      settings,
    }),
  };
}
/** Called only for an explicit workspace/provider inspection. Constructors and registration do no I/O. */
export async function readNativeContext(input: NativeReaderInput) {
  const files = new NativeContextFiles();
  let resolved;
  switch (input.provider) {
    case "claude":
      resolved = await claude(input, files);
      break;
    case "codex":
      resolved = await codex(input, files);
      break;
    case "opencode":
      resolved = await openCode(input, files);
      break;
  }
  return inspectNativeContext({
    ...input,
    plan: resolved.plan,
    files,
    readableRoots: [
      resolved.directory,
      ...resolved.plan.ruleRoots.map((entry) => entry.directory),
      ...(input.managedDirectory ? [input.managedDirectory] : []),
    ],
  });
}
