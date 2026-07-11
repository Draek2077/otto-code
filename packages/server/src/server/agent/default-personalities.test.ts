import { describe, expect, test } from "vitest";

import { DEFAULT_AGENT_PERSONALITIES } from "@otto-code/protocol/default-personalities";
import { AgentPersonalitySchema, PERSONALITY_ROLES } from "@otto-code/protocol/messages";
import { normalizePersonalityRoles } from "@otto-code/protocol/agent-personalities";
import { EFFORT_LEVELS } from "@otto-code/protocol/effort";
import { isClaudeManifestModelId } from "./providers/claude/model-manifest.js";
import { listLocalTtsVoices } from "../speech/providers/local/sherpa/tts-voices.js";

// Guardrails on the shipped starter roster. A typo in a model id, mode, or voice
// name would silently make a default "out of commission" on every host — these
// tests catch that at build time instead of on a user's machine. Provider-scoped
// facts (Claude model ids/modes, Kokoro voice names) are validated against the
// live catalogs here in the server package, where those catalogs live.

// The Claude permission modes (packages/.../claude/agent.ts DEFAULT_MODES). Kept
// as a literal because that list is not exported; if it changes, this mirror
// must too.
const CLAUDE_MODE_IDS = new Set(["default", "acceptEdits", "plan", "auto", "bypassPermissions"]);
const KOKORO_V1_MODEL = "kokoro-multi-lang-v1_0";
const KOKORO_V1_VOICE_NAMES = new Set(
  listLocalTtsVoices(KOKORO_V1_MODEL).map((voice) => voice.name),
);

describe("DEFAULT_AGENT_PERSONALITIES", () => {
  test("every entry is a schema-valid personality", () => {
    for (const personality of DEFAULT_AGENT_PERSONALITIES) {
      expect(() => AgentPersonalitySchema.parse(personality)).not.toThrow();
    }
  });

  test("ids are unique and stable builtin handles", () => {
    const ids = DEFAULT_AGENT_PERSONALITIES.map((personality) => personality.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith("personality_builtin_")).toBe(true);
    }
  });

  test("names are single-word handles safe for spawn-by-name", () => {
    for (const personality of DEFAULT_AGENT_PERSONALITIES) {
      expect(personality.name).toMatch(/^[A-Za-z0-9_-]{1,20}$/);
    }
  });

  test("the roster covers all seven roles", () => {
    const covered = new Set(
      DEFAULT_AGENT_PERSONALITIES.flatMap((personality) =>
        normalizePersonalityRoles(personality.roles),
      ),
    );
    for (const role of PERSONALITY_ROLES) {
      expect(covered.has(role)).toBe(true);
    }
  });

  test("every requested effort level is on the canonical scale", () => {
    for (const personality of DEFAULT_AGENT_PERSONALITIES) {
      if (personality.effortLevel !== undefined) {
        expect(EFFORT_LEVELS).toContain(personality.effortLevel);
      }
    }
  });

  test("every model is a real Claude manifest model", () => {
    for (const personality of DEFAULT_AGENT_PERSONALITIES) {
      expect(personality.provider).toBe("claude");
      expect(isClaudeManifestModelId(personality.model)).toBe(true);
    }
  });

  test("every mode is a valid Claude permission mode", () => {
    for (const personality of DEFAULT_AGENT_PERSONALITIES) {
      if (personality.modeId !== undefined) {
        expect(CLAUDE_MODE_IDS.has(personality.modeId)).toBe(true);
      }
    }
  });

  test("every voice is a Kokoro v1.0 voice", () => {
    for (const personality of DEFAULT_AGENT_PERSONALITIES) {
      expect(personality.voice).toBeDefined();
      expect(personality.voice?.provider).toBe("local");
      expect(personality.voice?.model).toBe(KOKORO_V1_MODEL);
      expect(KOKORO_V1_VOICE_NAMES.has(personality.voice?.name ?? "")).toBe(true);
    }
  });

  test("every personality ships two spinner glow colors", () => {
    for (const personality of DEFAULT_AGENT_PERSONALITIES) {
      expect(personality.spinner?.glowA).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(personality.spinner?.glowB).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
