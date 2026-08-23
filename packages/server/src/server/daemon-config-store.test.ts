import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  DaemonConfigStore,
  DAEMON_CONFIG_SECRET_SENTINEL,
  applyMutableProviderConfigToOverrides,
  redactDaemonConfigForClient,
} from "./daemon-config-store.js";
import { loadPersistedConfig } from "./persisted-config.js";
import {
  DEFAULT_AGENT_PROFILES,
  DEFAULT_AGENT_TEAMS,
} from "@otto-code/protocol/default-personalities";

describe("applyMutableProviderConfigToOverrides", () => {
  test("merges mutable provider fields onto provider overrides", () => {
    expect(
      applyMutableProviderConfigToOverrides(
        {
          gemini: {
            extends: "acp",
            label: "Gemini",
            command: ["gemini", "--acp"],
          },
        },
        {
          gemini: {
            enabled: false,
            description: "Gemini ACP",
            env: { GEMINI_AUTO_UPDATE: "0" },
          },
          claude: {
            additionalModels: [
              {
                id: "claude-custom",
                label: "claude-custom",
              },
            ],
          },
        },
      ),
    ).toEqual({
      gemini: {
        extends: "acp",
        label: "Gemini",
        description: "Gemini ACP",
        command: ["gemini", "--acp"],
        env: { GEMINI_AUTO_UPDATE: "0" },
        enabled: false,
      },
      claude: {
        additionalModels: [
          {
            id: "claude-custom",
            label: "claude-custom",
          },
        ],
      },
    });
  });
});

describe("DaemonConfigStore", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("patch persists relay state and emits its field change", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-daemon-config-store-"));
    tempDirs.push(paseoHome);
    const store = new DaemonConfigStore(paseoHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });
    const changes: unknown[] = [];
    store.onFieldChange("relay.enabled", (value) => changes.push(value));

    store.patch({ relay: { enabled: true } });

    expect(changes).toEqual([true]);
    expect(loadPersistedConfig(paseoHome).daemon?.relay?.enabled).toBe(true);
  });

  test("patch round-trips agent profiles through the strictly-parsed persisted config", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-daemon-config-store-"));
    tempDirs.push(paseoHome);
    const store = new DaemonConfigStore(paseoHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });

    store.patch({
      agentProfiles: [
        {
          id: "profile_ui",
          name: "UI work",
          icon: "🎨",
          provider: "claude",
          model: "claude-opus-5",
          modeId: "plan",
          thinkingOptionId: "think-hard",
          featureValues: { webSearch: true },
          notes: "Use for components, layout and design tokens.",
        },
      ],
    });

    expect(loadPersistedConfig(paseoHome).daemon?.agentProfiles).toEqual([
      {
        id: "profile_ui",
        name: "UI work",
        icon: "🎨",
        provider: "claude",
        model: "claude-opus-5",
        modeId: "plan",
        thinkingOptionId: "think-hard",
        featureValues: { webSearch: true },
        notes: "Use for components, layout and design tokens.",
      },
    ]);
    expect(store.get().agentProfiles).toHaveLength(1);
  });

  test("patch replaces the whole agent profile list rather than merging entries", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-daemon-config-store-"));
    tempDirs.push(paseoHome);
    const store = new DaemonConfigStore(paseoHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
      agentProfiles: [
        { id: "a", name: "Keep", provider: "claude" },
        { id: "b", name: "Drop", provider: "codex" },
      ],
    });

    store.patch({ agentProfiles: [{ id: "a", name: "Keep", provider: "claude" }] });

    expect(store.get().agentProfiles).toEqual([{ id: "a", name: "Keep", provider: "claude" }]);
    expect(loadPersistedConfig(paseoHome).daemon?.agentProfiles).toHaveLength(1);
  });

  test("rolls back config when a field transition fails", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-daemon-config-store-"));
    tempDirs.push(paseoHome);
    const store = new DaemonConfigStore(paseoHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });
    store.onFieldChange("relay.enabled", (enabled) => {
      if (enabled === true) {
        throw new Error("Relay transport failed to start");
      }
    });

    expect(() => store.patch({ relay: { enabled: true } })).toThrow(
      "Relay transport failed to start",
    );
    expect(store.get().relay?.enabled).toBe(false);
    expect(loadPersistedConfig(paseoHome).daemon?.relay?.enabled).toBe(false);
  });

  test("rejects relay patches when a launch override owns the setting", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-daemon-config-store-"));
    tempDirs.push(paseoHome);
    const store = new DaemonConfigStore(
      paseoHome,
      {
        relay: { enabled: false },
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
      { relayEnabledMutable: false },
    );

    expect(() => store.patch({ relay: { enabled: true } })).toThrow(
      "Relay is controlled by a daemon launch override",
    );
  });

  test("unrelated patches do not persist a one-launch relay override", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-daemon-config-store-"));
    tempDirs.push(paseoHome);
    const persisted = loadPersistedConfig(paseoHome);
    writeFileSync(
      path.join(paseoHome, "config.json"),
      `${JSON.stringify({
        ...persisted,
        daemon: { ...persisted.daemon, relay: { enabled: false } },
      })}\n`,
    );
    const store = new DaemonConfigStore(
      paseoHome,
      {
        relay: { enabled: true },
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
      { relayEnabledMutable: false },
    );

    store.patch({ browserTools: { enabled: true } });

    expect(loadPersistedConfig(paseoHome).daemon?.relay?.enabled).toBe(false);
  });

  test("patch persists provider enabled flags into config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const initial = loadPersistedConfig(ottoHome);
    const configPath = path.join(ottoHome, "config.json");
    // Reuse the validated serializer through the store path by seeding the file directly.
    // This keeps the test focused on the merge behavior.
    const seeded =
      JSON.stringify(
        {
          ...initial,
          agents: {
            providers: {
              gemini: {
                extends: "acp",
                label: "Gemini",
                command: ["gemini", "--acp"],
              },
            },
          },
        },
        null,
        2,
      ) + "\n";
    writeFileSync(configPath, seeded);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      providers: {
        gemini: { enabled: false },
      },
    });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.agents?.providers?.gemini).toEqual({
      extends: "acp",
      label: "Gemini",
      command: ["gemini", "--acp"],
      enabled: false,
    });
  });

  test("patch persists speech settings into config.json features", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        speech: {
          dictation: { enabled: true, stt: { provider: "local" } },
          voiceMode: { enabled: true, tts: { provider: "local" } },
        },
      },
      undefined,
    );

    store.patch({
      speech: {
        dictation: {
          enabled: true,
          stt: { provider: "local", model: "parakeet-tdt-0.6b-v3-int8", language: "fr" },
        },
        voiceMode: {
          tts: {
            provider: "local",
            model: "kokoro-multi-lang-v1_0",
            voice: "af_sky",
            speed: 1.2,
          },
        },
      },
    });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.features?.dictation).toEqual({
      enabled: true,
      stt: { provider: "local", model: "parakeet-tdt-0.6b-v3-int8", language: "fr" },
    });
    // af_sky is speaker id 10 in kokoro-multi-lang-v1_0; local voices persist as speakerId.
    expect(persisted.features?.voiceMode?.tts).toEqual({
      provider: "local",
      model: "kokoro-multi-lang-v1_0",
      speakerId: 10,
      speed: 1.2,
    });
  });

  test("patch maps openai tts voice names into the persisted voice enum", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        speech: {},
      },
      undefined,
    );

    store.patch({
      speech: {
        voiceMode: {
          tts: { provider: "openai", model: "gpt-4o-mini-tts", voice: "coral" },
        },
      },
    });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.features?.voiceMode?.tts).toEqual({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice: "coral",
    });
  });

  test("patch persists the speech openai api key into providers.openai and clears on empty", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        speech: {},
      },
      undefined,
    );

    store.patch({ speech: { openai: { apiKey: "  sk-test-123  " } } });
    expect(loadPersistedConfig(ottoHome).providers?.openai?.apiKey).toBe("sk-test-123");

    // Unrelated speech patches leave the stored key alone.
    store.patch({ speech: { voiceMode: { enabled: false } } });
    expect(loadPersistedConfig(ottoHome).providers?.openai?.apiKey).toBe("sk-test-123");

    // An empty key removes it from config.json.
    store.patch({ speech: { openai: { apiKey: "" } } });
    expect(loadPersistedConfig(ottoHome).providers?.openai?.apiKey).toBeUndefined();
  });

  test("patch persists append system prompt into config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      appendSystemPrompt: "Prefer terse replies.",
    });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.daemon?.appendSystemPrompt).toBe("Prefer terse replies.");
  });

  test("patch persists agent profiles into config.json and reloads them", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        agentProfiles: [],
      },
      undefined,
    );

    store.patch({
      agentProfiles: [
        {
          id: "p-sparky",
          name: "Sparky",
          provider: "openai-compat",
          model: "qwen3-coder",
          effortLevel: "high",
          modeId: "yolo",
          personalityPrompt: "Be bold and fast.",
          respectGlobalAppendPrompt: false,
          roles: ["chatter", "worker"],
          spinner: { glowA: "#4ec4ff", glowB: "#e14fe8" },
          voice: { provider: "local", model: "kokoro-multi-lang-v1_0", name: "af_heart" },
        },
      ],
    });

    // Survives a full reload from disk - the merge whitelist must persist the
    // section, not just hold it in memory.
    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.daemon?.agentProfiles).toEqual([
      {
        id: "p-sparky",
        name: "Sparky",
        provider: "openai-compat",
        model: "qwen3-coder",
        effortLevel: "high",
        modeId: "yolo",
        personalityPrompt: "Be bold and fast.",
        respectGlobalAppendPrompt: false,
        roles: ["chatter", "worker"],
        spinner: { glowA: "#4ec4ff", glowB: "#e14fe8" },
        voice: { provider: "local", model: "kokoro-multi-lang-v1_0", name: "af_heart" },
      },
    ]);

    // Deleting the last profile clears the roster on disk rather than leaving
    // the stale entry behind.
    store.patch({ agentProfiles: [] });
    expect(loadPersistedConfig(ottoHome).daemon?.agentProfiles).toEqual([]);
  });

  test("a legacy agentPersonalities section on disk is never rewritten", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    // COMPAT(agentPersonalities): the pre-convergence roster is a rollback
    // tombstone. An unrelated patch must leave it byte-for-byte alone rather
    // than folding the retired (and now unmaintained) mutable section over it.
    const legacy = [...DEFAULT_AGENT_PROFILES].slice(0, 2);
    const initial = loadPersistedConfig(ottoHome);
    writeFileSync(
      path.join(ottoHome, "config.json"),
      JSON.stringify(
        { ...initial, agents: { agentPersonalities: { personalities: legacy } } },
        null,
        2,
      ) + "\n",
    );

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        agentProfiles: [],
      },
      undefined,
    );
    store.patch({ appendSystemPrompt: "unrelated" });

    expect(
      loadPersistedConfig(ottoHome).agents?.agentPersonalities?.personalities?.map((e) => e.id),
    ).toEqual(legacy.map((e) => e.id));
  });

  test("patch persists model tier overrides into config.json and clears them", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        agentPersonalities: { personalities: [] },
      },
      undefined,
    );

    store.patch({
      modelTierOverrides: [
        { provider: "openai-compat", modelId: "my-local-70b", tier: "deep" },
        { provider: "openai-compat", modelId: "my-local-3b", tier: "fast" },
      ],
    });

    // In memory and on disk after a full reload.
    expect(store.get().modelTierOverrides).toEqual([
      { provider: "openai-compat", modelId: "my-local-70b", tier: "deep" },
      { provider: "openai-compat", modelId: "my-local-3b", tier: "fast" },
    ]);
    expect(loadPersistedConfig(ottoHome).agents?.modelTierOverrides).toEqual([
      { provider: "openai-compat", modelId: "my-local-70b", tier: "deep" },
      { provider: "openai-compat", modelId: "my-local-3b", tier: "fast" },
    ]);

    // Clearing the last tag empties the array on disk rather than leaving stale
    // entries behind (wholesale-replace semantics).
    store.patch({ modelTierOverrides: [] });
    expect(loadPersistedConfig(ottoHome).agents?.modelTierOverrides).toEqual([]);
  });

  const baseInitial = {
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
    agentPersonalities: { personalities: [] },
  } as const;

  test("seeds the shipped starter team onto a fresh host", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      { ...baseInitial, agentProfiles: [...DEFAULT_AGENT_PROFILES] },
      undefined,
    );

    store.seedDefaultProfilesIfAbsent(DEFAULT_AGENT_PROFILES);

    const persisted = loadPersistedConfig(ottoHome).daemon?.agentProfiles;
    expect(persisted).toHaveLength(DEFAULT_AGENT_PROFILES.length);
    expect(persisted?.map((entry) => entry.id)).toEqual(
      DEFAULT_AGENT_PROFILES.map((entry) => entry.id),
    );
  });

  test("never re-seeds when the section already exists, even when empty", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    // A user who cleared the whole team leaves an explicit empty section on disk.
    const initial = loadPersistedConfig(ottoHome);
    writeFileSync(
      path.join(ottoHome, "config.json"),
      JSON.stringify({ ...initial, daemon: { agentProfiles: [] } }, null, 2) + "\n",
    );

    const store = new DaemonConfigStore(ottoHome, { ...baseInitial, agentProfiles: [] }, undefined);

    store.seedDefaultProfilesIfAbsent(DEFAULT_AGENT_PROFILES);

    expect(loadPersistedConfig(ottoHome).daemon?.agentProfiles).toEqual([]);
  });

  test("does not seed a pre-convergence host that still carries a legacy roster", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    // The legacy section existing at all means this host has already made its
    // roster choices; seeding the starter team over them would resurrect
    // personalities the user deleted before upgrading.
    const initial = loadPersistedConfig(ottoHome);
    writeFileSync(
      path.join(ottoHome, "config.json"),
      JSON.stringify(
        { ...initial, agents: { agentPersonalities: { personalities: [] } } },
        null,
        2,
      ) + "\n",
    );

    const store = new DaemonConfigStore(ottoHome, { ...baseInitial, agentProfiles: [] }, undefined);
    store.seedDefaultProfilesIfAbsent(DEFAULT_AGENT_PROFILES);

    expect(loadPersistedConfig(ottoHome).daemon?.agentProfiles).toBeUndefined();
  });

  test("a cleared roster stays cleared across a simulated restart", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    // Mirror bootstrap: a fresh host seeds the roster BOTH in memory (here) and
    // on disk (the seed call below), so the two never diverge.
    const store = new DaemonConfigStore(
      ottoHome,
      { ...baseInitial, agentProfiles: [...DEFAULT_AGENT_PROFILES] },
      undefined,
    );

    // First boot records the seed on disk; the user then deletes all of it.
    store.seedDefaultProfilesIfAbsent(DEFAULT_AGENT_PROFILES);
    store.patch({ agentProfiles: [] });

    // Next boot must NOT resurrect the deleted team.
    store.seedDefaultProfilesIfAbsent(DEFAULT_AGENT_PROFILES);
    expect(loadPersistedConfig(ottoHome).daemon?.agentProfiles).toEqual([]);
  });

  test("imports a legacy personality roster into agent profiles, ids intact", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const legacy = [...DEFAULT_AGENT_PROFILES].slice(0, 3);
    const initial = loadPersistedConfig(ottoHome);
    writeFileSync(
      path.join(ottoHome, "config.json"),
      JSON.stringify(
        { ...initial, agents: { agentPersonalities: { personalities: legacy } } },
        null,
        2,
      ) + "\n",
    );

    const store = new DaemonConfigStore(ottoHome, { ...baseInitial, agentProfiles: [] }, undefined);
    store.importLegacyPersonalitiesIfNeeded();

    const persisted = loadPersistedConfig(ottoHome);
    // Ids are preserved verbatim: personality memory files, the usage stats
    // store and agentTeams.memberIds all key off them.
    expect(persisted.daemon?.agentProfiles?.map((entry) => entry.id)).toEqual(
      legacy.map((entry) => entry.id),
    );
    // The in-memory config is updated too, so the very first read after the
    // import sees the roster without waiting for a restart.
    expect(store.get().agentProfiles?.map((entry) => entry.id)).toEqual(
      legacy.map((entry) => entry.id),
    );
    // The legacy section stays on disk as a rollback tombstone.
    expect(persisted.agents?.agentPersonalities?.personalities).toHaveLength(legacy.length);
  });

  test("an imported roster the user then deletes stays deleted", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const legacy = [...DEFAULT_AGENT_PROFILES].slice(0, 2);
    const initial = loadPersistedConfig(ottoHome);
    writeFileSync(
      path.join(ottoHome, "config.json"),
      JSON.stringify(
        { ...initial, agents: { agentPersonalities: { personalities: legacy } } },
        null,
        2,
      ) + "\n",
    );

    const store = new DaemonConfigStore(ottoHome, { ...baseInitial, agentProfiles: [] }, undefined);
    store.importLegacyPersonalitiesIfNeeded();
    store.patch({ agentProfiles: [] });

    // The marker, not the roster being empty, is what makes the import one-shot.
    store.importLegacyPersonalitiesIfNeeded();
    expect(loadPersistedConfig(ottoHome).daemon?.agentProfiles).toEqual([]);
  });

  test("an agentProfiles patch replaces the whole stored roster", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      { ...baseInitial, agentProfiles: [...DEFAULT_AGENT_PROFILES] },
      undefined,
    );
    store.seedDefaultProfilesIfAbsent(DEFAULT_AGENT_PROFILES);

    const kept = DEFAULT_AGENT_PROFILES[0];
    if (!kept) throw new Error("expected a starter profile");
    const next = store.patch({ agentProfiles: [kept] });
    expect(next.agentProfiles).toHaveLength(1);
    expect(loadPersistedConfig(ottoHome).daemon?.agentProfiles).toHaveLength(1);
  });

  test("seeds the starter team on a fresh host without activating it, and never re-seeds", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        agentTeams: { teams: [...DEFAULT_AGENT_TEAMS] },
      },
      undefined,
    );

    store.seedDefaultTeamsIfAbsent(DEFAULT_AGENT_TEAMS);

    const persisted = loadPersistedConfig(ottoHome).agents?.agentTeams;
    expect(persisted?.teams?.map((entry) => entry.id)).toEqual(
      DEFAULT_AGENT_TEAMS.map((entry) => entry.id),
    );
    // Seeded but NOT active: a fresh host behaves exactly like today until the
    // user opts in via the switcher.
    expect(persisted?.activeTeamId).toBeUndefined();

    // The user deletes the starter team; the next boot must not resurrect it.
    store.patch({ agentTeams: { teams: [] } });
    store.seedDefaultTeamsIfAbsent(DEFAULT_AGENT_TEAMS);
    expect(loadPersistedConfig(ottoHome).agents?.agentTeams?.teams).toEqual([]);
  });

  test("patch persists agent teams and the active team id into config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      agentTeams: {
        teams: [
          {
            id: "team-crew",
            name: "Shipping crew",
            avatar: { color: "#4ec4ff" },
            teamPrompt: "Work as a coordinated crew.",
            memberIds: ["p-atlas", "p-dash"],
          },
        ],
        activeTeamId: "team-crew",
      },
    });

    // Survives a full reload from disk - the merge whitelist must persist the
    // section, not just hold it in memory.
    const persisted = loadPersistedConfig(ottoHome).agents?.agentTeams;
    expect(persisted?.teams).toEqual([
      {
        id: "team-crew",
        name: "Shipping crew",
        avatar: { color: "#4ec4ff" },
        teamPrompt: "Work as a coordinated crew.",
        memberIds: ["p-atlas", "p-dash"],
      },
    ]);
    expect(persisted?.activeTeamId).toBe("team-crew");

    // Deactivating persists as an omitted key, never a stale id on disk.
    store.patch({ agentTeams: { activeTeamId: null } });
    const deactivated = loadPersistedConfig(ottoHome).agents?.agentTeams;
    expect(deactivated?.teams).toHaveLength(1);
    expect(deactivated?.activeTeamId).toBeUndefined();

    // Deleting the last team clears the array on disk rather than leaving the
    // stale entry behind.
    store.patch({ agentTeams: { teams: [] } });
    expect(loadPersistedConfig(ottoHome).agents?.agentTeams?.teams).toEqual([]);
  });

  test("an absent teams section stays absent until the first teams write", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    // Unrelated patches must not materialize an empty teams section - its
    // absence is the "never initialized" marker future seeding keys off.
    store.patch({ appendSystemPrompt: "hello" });
    expect(loadPersistedConfig(ottoHome).agents?.agentTeams).toBeUndefined();
  });

  test("deleting the active team heals the dangling active id", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        agentTeams: {
          teams: [
            { id: "team-a", name: "A" },
            { id: "team-b", name: "B" },
          ],
          activeTeamId: "team-a",
        },
      },
      undefined,
    );

    // A client that deletes team-a without clearing the active id in the same
    // patch must not leave a dangling reference behind.
    const next = store.patch({ agentTeams: { teams: [{ id: "team-b", name: "B" }] } });
    expect(next.agentTeams?.activeTeamId).toBeNull();
    expect(loadPersistedConfig(ottoHome).agents?.agentTeams?.activeTeamId).toBeUndefined();
  });

  test("activating an unknown team id heals to no active team", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        agentTeams: { teams: [{ id: "team-a", name: "A" }] },
      },
      undefined,
    );

    const next = store.patch({ agentTeams: { activeTeamId: "team-gone" } });
    expect(next.agentTeams?.activeTeamId).toBeNull();
  });

  test("patch persists browser tools opt-in into config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({ browserTools: { enabled: true } });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.daemon?.browserTools).toEqual({ enabled: true });
  });

  test("patch persists provider additional models into config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      providers: {
        claude: {
          additionalModels: [
            {
              id: "claude-custom",
              label: "claude-custom",
            },
          ],
        },
      },
    });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.agents?.providers?.claude).toEqual({
      additionalModels: [
        {
          id: "claude-custom",
          label: "claude-custom",
        },
      ],
    });
  });

  test("patch persists daemon append system prompt into config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      appendSystemPrompt: "Prefer terse replies.",
    });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.daemon?.appendSystemPrompt).toBe("Prefer terse replies.");
  });

  test("patch persists enable terminal agent hooks into config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({ enableTerminalAgentHooks: true });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.daemon?.enableTerminalAgentHooks).toBe(true);
  });

  test("patch persists terminal title and Windows shell preferences into config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      terminalTitleMode: "default",
      terminalTitleIncludePaths: true,
      defaultTerminalShell: "powershell-7",
    });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.daemon).toMatchObject({
      terminalTitleMode: "default",
      terminalTitleIncludePaths: true,
      defaultTerminalShell: "powershell-7",
    });
  });

  test("patch persists metadata generation providers into config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      metadataGeneration: {
        providers: [
          { provider: "claude", model: "haiku" },
          { provider: "codex", model: "gpt-5.4-mini", thinkingOptionId: "low" },
        ],
      },
    });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.agents?.metadataGeneration).toEqual({
      providers: [
        { provider: "claude", model: "haiku" },
        { provider: "codex", model: "gpt-5.4-mini", thinkingOptionId: "low" },
      ],
      enabled: true,
      preferWriterPersonalities: false,
    });
  });

  test("patch persists clearing metadata generation providers into config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const configPath = path.join(ottoHome, "config.json");
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          agents: {
            metadataGeneration: {
              providers: [{ provider: "claude", model: "haiku" }],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        metadataGeneration: { providers: [{ provider: "claude", model: "haiku" }] },
      },
      undefined,
    );

    store.patch({ metadataGeneration: { providers: [] } });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.agents?.metadataGeneration).toEqual({
      providers: [],
      enabled: true,
      preferWriterPersonalities: false,
    });
  });

  test("patch persists custom ACP provider overrides into config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        metadataGeneration: { providers: [] },
      },
      undefined,
    );

    store.patch({
      providers: {
        "otto-e2e-acp": {
          extends: "acp",
          label: "Otto E2E ACP",
          description: "E2E ACP provider fixture",
          command: ["npx", "-y", "--version"],
          env: {},
        },
      },
    });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.agents?.providers?.["otto-e2e-acp"]).toEqual({
      extends: "acp",
      label: "Otto E2E ACP",
      description: "E2E ACP provider fixture",
      command: ["npx", "-y", "--version"],
      env: {},
    });
  });

  test("null provider patch removes the entry from runtime config and config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const configPath = path.join(ottoHome, "config.json");
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          agents: {
            providers: {
              lmstudio: {
                extends: "codex",
                label: "LM Studio",
                env: { OPENAI_BASE_URL: "http://localhost:1234/v1" },
              },
              gemini: {
                extends: "acp",
                label: "Gemini",
                command: ["gemini", "--acp"],
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {
          lmstudio: {
            extends: "codex",
            label: "LM Studio",
            env: { OPENAI_BASE_URL: "http://localhost:1234/v1" },
          },
          gemini: {
            extends: "acp",
            label: "Gemini",
            command: ["gemini", "--acp"],
          },
        },
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    const removals: string[][] = [];
    store.onChange((_config, details) => {
      removals.push(details.removedProviderIds);
    });

    const next = store.patch({ providers: { lmstudio: null } });

    expect(next.providers.lmstudio).toBeUndefined();
    expect(next.providers.gemini).toBeDefined();
    expect(removals).toEqual([["lmstudio"]]);

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.agents?.providers?.lmstudio).toBeUndefined();
    expect(persisted.agents?.providers?.gemini).toBeDefined();
  });

  // The Settings "Remove provider" button sends this shape, not the null
  // sentinel. Both are in MutableDaemonConfigPatchSchema, so a store that only
  // honoured the sentinel typechecked and silently did nothing.
  test("removeProviders patch removes the entry from runtime config and config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const configPath = path.join(ottoHome, "config.json");
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          agents: {
            providers: {
              lmstudio: { extends: "codex", label: "LM Studio" },
              gemini: { extends: "acp", label: "Gemini", command: ["gemini", "--acp"] },
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {
          lmstudio: { extends: "codex", label: "LM Studio" },
          gemini: { extends: "acp", label: "Gemini", command: ["gemini", "--acp"] },
        },
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    const removals: string[][] = [];
    store.onChange((_config, details) => {
      removals.push(details.removedProviderIds);
    });

    const next = store.patch({ removeProviders: ["lmstudio"] });

    expect(next.providers.lmstudio).toBeUndefined();
    expect(next.providers.gemini).toBeDefined();
    expect(removals).toEqual([["lmstudio"]]);

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.agents?.providers?.lmstudio).toBeUndefined();
    expect(persisted.agents?.providers?.gemini).toBeDefined();
  });

  test("removing the last provider drops the providers key from config.json", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const configPath = path.join(ottoHome, "config.json");
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          agents: {
            providers: {
              lmstudio: {
                extends: "codex",
                label: "LM Studio",
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {
          lmstudio: { extends: "codex", label: "LM Studio" },
        },
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({ providers: { lmstudio: null } });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.agents?.providers).toBeUndefined();
  });

  test("masks host-provider secrets on the client view and restores an unchanged sentinel patch", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        speech: { openai: { apiKey: "sk-real-speech-key" } },
        gitHosting: {
          providers: { bitbucketCloud: { email: "dev@example.com", apiToken: "real-bb-token" } },
        },
      },
      undefined,
    );

    // The client view masks both secrets but keeps the non-secret email.
    const clientView = redactDaemonConfigForClient(store.get());
    expect(clientView.speech?.openai?.apiKey).toBe(DAEMON_CONFIG_SECRET_SENTINEL);
    expect(clientView.gitHosting?.providers?.bitbucketCloud?.apiToken).toBe(
      DAEMON_CONFIG_SECRET_SENTINEL,
    );
    expect(clientView.gitHosting?.providers?.bitbucketCloud?.email).toBe("dev@example.com");
    // get() itself is untouched - internal consumers still see the real secret.
    expect(store.get().gitHosting?.providers?.bitbucketCloud?.apiToken).toBe("real-bb-token");

    // Saving the config unchanged sends the sentinel back; the stored secret must
    // survive, while a sibling field (email) still changes.
    store.patch({
      gitHosting: {
        providers: {
          bitbucketCloud: { email: "new@example.com", apiToken: DAEMON_CONFIG_SECRET_SENTINEL },
        },
      },
      speech: { openai: { apiKey: DAEMON_CONFIG_SECRET_SENTINEL } },
    });

    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.gitHosting?.providers?.bitbucketCloud?.apiToken).toBe("real-bb-token");
    expect(persisted.gitHosting?.providers?.bitbucketCloud?.email).toBe("new@example.com");
    expect(persisted.providers?.openai?.apiKey).toBe("sk-real-speech-key");
  });

  test("applies a genuinely new secret and clears it on empty", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-daemon-config-store-"));
    tempDirs.push(ottoHome);

    const store = new DaemonConfigStore(
      ottoHome,
      {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        gitHosting: {
          providers: { bitbucketCloud: { email: "dev@example.com", apiToken: "old-token" } },
        },
      },
      undefined,
    );

    store.patch({
      gitHosting: { providers: { bitbucketCloud: { apiToken: "brand-new-token" } } },
    });
    expect(loadPersistedConfig(ottoHome).gitHosting?.providers?.bitbucketCloud?.apiToken).toBe(
      "brand-new-token",
    );

    store.patch({ gitHosting: { providers: { bitbucketCloud: { apiToken: "" } } } });
    const persisted = loadPersistedConfig(ottoHome);
    expect(persisted.gitHosting?.providers?.bitbucketCloud?.apiToken).toBeUndefined();
    expect(persisted.gitHosting?.providers?.bitbucketCloud?.email).toBe("dev@example.com");
  });
});
