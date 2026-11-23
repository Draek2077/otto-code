import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";

export type NativeConfigResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Parse bounded local settings; the projections below retain only context knobs. Diagnostics never echo raw settings. */
export function parseNativeConfig(
  text: string,
  format: "jsonc" | "toml",
): NativeConfigResult<unknown> {
  if (Buffer.byteLength(text, "utf8") > 131072)
    return {
      ok: false,
      message: "The provider settings exceed the bounded context inspection limit.",
    };
  try {
    if (format === "toml") return { ok: true, value: parseToml(text) };
    const errors: ParseError[] = [];
    const value: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
    return errors.length
      ? { ok: false, message: "The provider settings contain invalid JSONC." }
      : { ok: true, value };
  } catch {
    return { ok: false, message: "The provider settings contain invalid TOML." };
  }
}

const FileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !/[\\/]/u.test(value) && value !== "." && value !== "..");
const CodexContextSchema = z.object({
  project_doc_fallback_filenames: z.array(FileNameSchema).max(32).optional(),
  project_doc_max_bytes: z.number().int().min(0).max(1048576).optional(),
  skills: z
    .object({
      config: z.array(z.object({ path: z.string(), enabled: z.boolean().optional() })).optional(),
    })
    .optional(),
});
export interface CodexContextSettings {
  fallbackNames: string[];
  maxBytes: number;
  disabledSkillPaths: string[];
}
export function codexContextSettings(value: unknown): NativeConfigResult<CodexContextSettings> {
  const parsed = CodexContextSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      message: "Codex context discovery settings are invalid; no configured override was guessed.",
    };
  return {
    ok: true,
    value: {
      fallbackNames: parsed.data.project_doc_fallback_filenames ?? [],
      maxBytes: parsed.data.project_doc_max_bytes ?? 32768,
      disabledSkillPaths: (parsed.data.skills?.config ?? [])
        .filter((entry) => entry.enabled === false)
        .map((entry) => entry.path),
    },
  };
}

export const ClaudeInstructionModeSchema = z.enum([
  "claude-md-or-agents-md",
  "claude-md-and-agents-md",
  "claude-md",
  "managed-only",
]);
const ClaudeContextSchema = z.object({
  autoMemoryEnabled: z.boolean().optional(),
  autoMemoryDirectory: z.string().optional(),
  claudeMdExcludes: z.array(z.string()).optional(),
  enabledPlugins: z.record(z.string(), z.boolean()).optional(),
  pluginConfigs: z.record(z.string(), z.unknown()).optional(),
});
const InstructionPluginSchema = z.object({
  options: z.object({ instructionFiles: ClaudeInstructionModeSchema.optional() }).optional(),
});
export interface ClaudeContextSettings {
  instructionMode: z.infer<typeof ClaudeInstructionModeSchema> | null;
  memoryEnabled: boolean;
  memoryDirectory: string | null;
  excludes: string[];
  enabledPlugins: Record<string, boolean>;
}
export function claudeContextSettings(
  values: readonly unknown[],
): NativeConfigResult<ClaudeContextSettings> {
  const result: ClaudeContextSettings = {
    instructionMode: null,
    memoryEnabled: true,
    memoryDirectory: null,
    excludes: [],
    enabledPlugins: {},
  };
  for (const [index, value] of values.entries()) {
    const parsed = ClaudeContextSchema.safeParse(value);
    if (!parsed.success)
      return {
        ok: false,
        message:
          "Claude context discovery settings are invalid; no configured override was guessed.",
      };
    const data = parsed.data;
    if (data.autoMemoryEnabled !== undefined) result.memoryEnabled = data.autoMemoryEnabled;
    if (data.autoMemoryDirectory !== undefined) result.memoryDirectory = data.autoMemoryDirectory;
    result.excludes.push(...(data.claudeMdExcludes ?? []));
    Object.assign(result.enabledPlugins, data.enabledPlugins);
    // Project/local settings cannot select the built-in instruction mode. Only the
    // first (user) settings document participates here; managed policy is projected separately.
    if (index === 0) {
      const plugin = InstructionPluginSchema.safeParse(
        data.pluginConfigs?.["cc-plugin-agents-md@builtin"] ??
          data.pluginConfigs?.["agents-md@builtin"],
      );
      if (plugin.success) result.instructionMode = plugin.data.options?.instructionFiles ?? null;
    }
  }
  return { ok: true, value: result };
}

const OpenCodeContextSchema = z.object({
  instructions: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
});
export interface OpenCodeContextSettings {
  instructions: string[];
  skillPaths: string[];
}
export function openCodeContextSettings(
  values: readonly unknown[],
): NativeConfigResult<OpenCodeContextSettings> {
  const result: OpenCodeContextSettings = { instructions: [], skillPaths: [] };
  for (const value of values) {
    const parsed = OpenCodeContextSchema.safeParse(value);
    if (!parsed.success)
      return {
        ok: false,
        message:
          "OpenCode context discovery settings are invalid; no configured override was guessed.",
      };
    result.instructions.push(...(parsed.data.instructions ?? []));
    result.skillPaths.push(...(parsed.data.skills ?? []));
  }
  return { ok: true, value: result };
}
