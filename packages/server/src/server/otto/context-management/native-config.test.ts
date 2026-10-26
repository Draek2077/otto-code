import { expect, test } from "vitest";
import {
  parseNativeConfig,
  codexContextSettings,
  claudeContextSettings,
  openCodeContextSettings,
} from "./native-config.js";

test("Codex TOML keeps explicit discovery limits/fallbacks and disabled skill identities, never credentials", () => {
  const raw = parseNativeConfig(
    'project_doc_fallback_filenames = ["TEAM.md", ".agents.md"]\nproject_doc_max_bytes = 65536\napi_key = "DO_NOT_RETURN_THIS"\n[[skills.config]]\npath = "/fixture/skill"\nenabled = false\n',
    "toml",
  );
  expect(raw.ok).toBe(true);
  if (!raw.ok) throw Error("Expected fixture config");
  const result = codexContextSettings(raw.value);
  expect(result).toEqual({
    ok: true,
    value: {
      fallbackNames: ["TEAM.md", ".agents.md"],
      maxBytes: 65536,
      disabledSkillPaths: ["/fixture/skill"],
    },
  });
  expect(JSON.stringify(result)).not.toContain("DO_NOT_RETURN_THIS");
});
test("Codex defaults and a deliberate zero-byte limit remain distinct", () => {
  expect(codexContextSettings({})).toMatchObject({
    ok: true,
    value: { fallbackNames: [], maxBytes: 32768 },
  });
  expect(codexContextSettings({ project_doc_max_bytes: 0 })).toMatchObject({
    ok: true,
    value: { maxBytes: 0 },
  });
  expect(codexContextSettings({ project_doc_fallback_filenames: ["../outside.md"] }).ok).toBe(
    false,
  );
});
test("JSONC settings parse comments and trailing commas without a second permissive parser", () => {
  expect(parseNativeConfig('{// fixture\n"instructions": ["rules/*.md",],}', "jsonc")).toEqual({
    ok: true,
    value: { instructions: ["rules/*.md"] },
  });
});
test.each(["jsonc", "toml"] as const)(
  "malformed %s diagnostics never return the raw secret-bearing line",
  (format) => {
    const result = parseNativeConfig('api_key = "PRIVATE_SECRET\n{ broken', format);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SECRET");
  },
);
test("Claude merges enabled-plugin selections and exclusions; only the user document selects instruction mode", () => {
  const result = claudeContextSettings([
    {
      apiKey: "SECRET",
      enabledPlugins: { "example@local": true },
      claudeMdExcludes: ["**/vendor/**"],
      pluginConfigs: {
        "cc-plugin-agents-md@builtin": { options: { instructionFiles: "claude-md-and-agents-md" } },
      },
    },
    {
      enabledPlugins: { "example@local": false, "other@local": true },
      autoMemoryEnabled: false,
      pluginConfigs: {
        "cc-plugin-agents-md@builtin": { options: { instructionFiles: "managed-only" } },
      },
    },
  ]);
  expect(result).toEqual({
    ok: true,
    value: {
      instructionMode: "claude-md-and-agents-md",
      memoryEnabled: false,
      memoryDirectory: null,
      excludes: ["**/vendor/**"],
      enabledPlugins: { "example@local": false, "other@local": true },
    },
  });
  expect(JSON.stringify(result)).not.toContain("SECRET");
});
test("OpenCode preserves instructions in document order and projects only discovery fields", () => {
  const result = openCodeContextSettings([
    { instructions: ["global.md"], provider: { secret: "SECRET" } },
    {
      instructions: ["docs/*.md", "https://fixture.invalid/rules.md"],
      skills: ["/fixture/skills"],
    },
  ]);
  expect(result).toEqual({
    ok: true,
    value: {
      instructions: ["global.md", "docs/*.md", "https://fixture.invalid/rules.md"],
      skillPaths: ["/fixture/skills"],
    },
  });
  expect(JSON.stringify(result)).not.toContain("SECRET");
});
test("oversized config is refused before parsing and invalid known fields are not reset silently", () => {
  expect(parseNativeConfig(" ".repeat(131073), "jsonc").ok).toBe(false);
  expect(claudeContextSettings([{ autoMemoryEnabled: "false" }]).ok).toBe(false);
  expect(openCodeContextSettings([{ instructions: "rules.md" }]).ok).toBe(false);
});
