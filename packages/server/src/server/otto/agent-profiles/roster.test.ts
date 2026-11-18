import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { activeTeam, bindProfile, teamProfiles } from "@getpaseo/protocol/otto/agent-teams";
import { captureWorkflowTeam, boundRole } from "../workflows/team-roles.js";
import { recoverLegacyRoster } from "./legacy.js";
import { authorProfile } from "./author.js";
import { resolveHostProfile, selectProfile } from "./selection.js";
import { utteranceVoice } from "../speech/profile-voice.js";
import { initialRoster, missingStarters } from "@getpaseo/protocol/otto/starter-roster";
import { AuthoredCues } from "@getpaseo/protocol/otto/profile-authoring";
import type { WorkflowLaunch } from "@getpaseo/plugin/otto/workflows";
import type { AgentSessionConfig } from "../../agent/agent-sdk-types.js";
const writer = {
  id: "writer",
  name: "Scribe",
  provider: "mock",
  model: "model-1",
  roles: ["writer", "chatter"],
  personalityPrompt: "Write briefly.",
  voiceCues: { waiting: ["One moment."] },
};
const coder = {
  id: "coder",
  name: "Builder",
  provider: "mock",
  model: "model-2",
  roles: ["worker", "chatter"],
};
const team = {
  id: "alpha",
  name: "Alpha",
  memberIds: ["coder", "missing", "writer", "coder"],
  teamPrompt: "Review together.",
};
const roster = {
  agentProfiles: [writer, coder],
  agentTeams: { activeTeamId: team.id, teams: [team] },
};
const cfg: AgentSessionConfig = { provider: "mock", cwd: "/project" };
function port() {
  return {
    setModel: vi.fn(async () => {}),
    setThinking: vi.fn(async () => null),
    setMode: vi.fn(async () => null),
    setFeature: vi.fn(async () => {}),
    writeBinding: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
  };
}
describe("Otto host Profile binding", () => {
  it("offers the historical Crew on an untouched host without activating it or restoring deleted members", () => {
    const fresh = initialRoster(undefined, undefined);
    expect(fresh.agentProfiles.map((p) => p.name)).toEqual([
      "Atlas",
      "Sage",
      "Vera",
      "Pixel",
      "Dash",
      "Sprocket",
    ]);
    expect(fresh.agentTeams?.teams?.[0].name).toBe("The Otto Crew");
    expect(activeTeam(fresh.agentTeams)).toBeUndefined();
    expect(initialRoster([], { teams: [] })).toEqual({
      agentProfiles: [],
      agentTeams: { teams: [] },
    });
    const edited = { ...fresh.agentProfiles[0], name: "My Atlas" };
    expect(missingStarters([edited], fresh.agentTeams?.teams ?? []).profiles).toHaveLength(5);
    expect(missingStarters([edited], []).profiles.some((p) => p.id === edited.id)).toBe(false);
  });
  it("uses a compatible Profile voice without changing host speed or sending local speech to another backend", () => {
    const local = {
      provider: "local" as const,
      model: "kokoro-en-v0_19",
      voice: "default",
      speed: 1.5,
    };
    const remote = { provider: "openai" as const, model: "tts-1", voice: "alloy", speed: 1.5 };
    expect(utteranceVoice(local, remote, true)).toBe(local);
    expect(utteranceVoice(remote, { ...remote, voice: "not advertised" }, true)).toBe(remote);
    expect(utteranceVoice(remote, { ...remote, voice: "cedar", speed: 1 }, true)).toEqual({
      ...remote,
      voice: "cedar",
    });
    expect(() => utteranceVoice(local, remote, false)).toThrow("Save");
  });
  it("orders membership by Team priority and keeps the host catalog when unscoped", () => {
    expect(teamProfiles(activeTeam(roster.agentTeams), roster.agentProfiles)).toEqual([
      coder,
      writer,
    ]);
    expect(teamProfiles(undefined, roster.agentProfiles)).toEqual([writer, coder]);
  });
  it("binds stable identity, owner instructions and spoken lines", () => {
    expect(bindProfile(roster, writer.id, "mock").binding).toMatchObject({
      id: "writer",
      name: "Scribe",
      prompt: "Review together.\n\nWrite briefly.",
      voiceCues: writer.voiceCues,
    });
    expect(() => bindProfile(roster, writer.id, "other")).toThrow("provider");
  });
  it("resolves a legacy effort against the actual model and refuses missing models", async () => {
    const p = { ...writer, effortLevel: "high" };
    const catalog = {
      provider: "mock",
      enabled: true,
      status: "ready" as const,
      models: [
        {
          provider: "mock",
          id: p.model,
          label: "One",
          thinkingOptions: [
            { id: "medium", label: "Medium" },
            { id: "max", label: "Maximum" },
          ],
        },
      ],
    };
    const selected = await resolveHostProfile(
      { agentProfiles: [p] },
      p.id,
      cfg,
      async () => catalog,
    );
    expect(selected.profile.thinkingOptionId).toBe("medium");
    await expect(
      resolveHostProfile({ agentProfiles: [p] }, p.id, cfg, async () => ({
        ...catalog,
        models: [],
      })),
    ).rejects.toThrow("unavailable");
  });
  it("skips an unusable Team member and captures the next eligible member for its role", () => {
    const unavailable = { ...coder, thinkingOptionId: "unsupported" };
    const alternate = { ...writer, roles: ["coder"] };
    const snapshot = captureWorkflowTeam({ ...roster, agentProfiles: [unavailable, alternate] }, [
      {
        provider: "mock",
        enabled: true,
        status: "ready",
        models: [coder, writer].map((p) => ({ provider: "mock", id: p.model, label: p.model })),
      },
    ]);
    expect(snapshot?.roles.find((r) => r.role === "coder")?.name).toBe(alternate.name);
  });
  it("captures Workflow seats including worker aliases before the roster changes", () => {
    const current = structuredClone(roster);
    const snapshot = captureWorkflowTeam(current);
    current.agentProfiles[1].model = "changed";
    const launch = { teamSnapshot: snapshot } as WorkflowLaunch;
    expect(boundRole(launch, "coder")?.seat.model).toBe("model-2");
    expect(boundRole(launch, "worker")?.name).toBe("Builder");
    expect(() => boundRole(launch, "judger")).toThrow("judger");
  });
  it("applies an instruction change through one resumable session with identical identity", async () => {
    const adapter = port(),
      selected = bindProfile(roster, writer.id, "mock");
    await selectProfile(cfg, undefined, selected, undefined, adapter);
    expect(adapter.resume).toHaveBeenCalledWith(
      expect.objectContaining({ model: "model-1", ottoProfile: selected.binding }),
      expect.stringContaining("Scribe"),
    );
    expect(adapter.setModel).not.toHaveBeenCalled();
  });
  it("never publishes a new identity when resuming or changing the model fails", async () => {
    const adapter = port();
    adapter.resume.mockRejectedValueOnce(new Error("busy"));
    await expect(
      selectProfile(cfg, undefined, bindProfile(roster, writer.id, "mock"), undefined, adapter),
    ).rejects.toThrow("busy");
    const raw = bindProfile({ agentProfiles: [coder] }, coder.id, "mock");
    adapter.setModel.mockRejectedValueOnce(new Error("unavailable"));
    await expect(selectProfile(cfg, undefined, raw, undefined, adapter)).rejects.toThrow(
      "unavailable",
    );
    expect(adapter.writeBinding).not.toHaveBeenCalled();
  });
  it("applies a multi-setting Profile in one resume and keeps its prior identity on rejection", async () => {
    const p = { ...coder, modeId: "fast" };
    const selected = bindProfile({ agentProfiles: [p] }, p.id, "mock");
    const adapter = port();
    adapter.resume.mockRejectedValue(new Error("resume unavailable"));
    await expect(selectProfile(cfg, "prior", selected, undefined, adapter)).rejects.toThrow(
      "resume unavailable",
    );
    expect(adapter.resume).toHaveBeenCalledWith(
      expect.objectContaining({ model: p.model, modeId: p.modeId }),
      expect.stringContaining(p.name),
    );
    expect(adapter.setMode).not.toHaveBeenCalled();
    expect(adapter.setModel).not.toHaveBeenCalled();
    expect(adapter.writeBinding).not.toHaveBeenCalled();
  });
  it("detaches a prompt-free binding when explicitly picking the same bare model", async () => {
    const adapter = port(),
      selected = bindProfile({ agentProfiles: [coder] }, coder.id, "mock");
    await selectProfile({ ...cfg, ottoProfile: selected.binding }, "old", null, "model-2", adapter);
    expect(adapter.setModel).toHaveBeenCalledWith("model-2");
    expect(adapter.writeBinding).toHaveBeenCalledWith(undefined, null);
  });
  it("resumes the provider before detaching a Profile whose lessons are in the active prompt", async () => {
    const selected = bindProfile({ agentProfiles: [coder] }, coder.id, "mock");
    const adapter = { ...port(), refreshMemory: vi.fn(async () => true) };
    await selectProfile(
      { ...cfg, model: coder.model, ottoProfile: selected.binding },
      "Builder",
      null,
      coder.model,
      adapter,
    );
    expect(adapter.refreshMemory).toHaveBeenCalledWith(undefined);
    expect(adapter.resume).toHaveBeenCalledWith(
      { model: coder.model, ottoProfile: undefined },
      null,
    );
    expect(adapter.setModel).not.toHaveBeenCalled();
    expect(adapter.writeBinding).not.toHaveBeenCalled();
  });
  it("respects Otto 0.9's own migration marker when a retained legacy list contains a deleted Profile", () => {
    const config = { daemon: { agentProfiles: [] } };
    const old = {
      daemon: { agentProfilesImportedPersonalities: true },
      agents: { agentPersonalities: { personalities: [writer] }, agentTeams: roster.agentTeams },
    };
    const dir = mkdtempSync(path.join(tmpdir(), "otto-profile-tombstone-"));
    try {
      expect(recoverLegacyRoster(config, old, path.join(dir, "absent.json"))).toBe(true);
      expect(config.daemon).toMatchObject({ agentProfiles: [], agentTeams: roster.agentTeams });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("recovers a previously split roster once, preserving newer values and unrelated config", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "otto-profile-recovery-"));
    try {
      const side = path.join(dir, "otto.json");
      writeFileSync(
        side,
        JSON.stringify({
          agents: {
            agentPersonalities: { personalities: [writer] },
            agentTeams: roster.agentTeams,
          },
        }),
      );
      const config = { daemon: { other: true, agentProfiles: [{ ...writer, name: "Renamed" }] } };
      expect(recoverLegacyRoster(config, {}, side)).toBe(true);
      expect(config.daemon).toMatchObject({
        other: true,
        agentProfiles: [{ name: "Renamed", voiceCues: writer.voiceCues }],
        agentTeams: roster.agentTeams,
      });
      config.daemon.agentProfiles = [];
      expect(recoverLegacyRoster(config, {}, side)).toBe(false);
      expect(config.daemon.agentProfiles).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("generates validated lines for four moments in an ephemeral directory", async () => {
    const cues = { join: ["Hello"], thinking: ["Thinking"], waiting: ["Waiting"], done: ["Done"] };
    let cwd = "";
    const result = await authorProfile(
      {
        generate: async (request) => {
          cwd = request.cwd;
          expect(existsSync(cwd)).toBe(true);
          return request.schema.parse(cues);
        },
      },
      { kind: "cues", roles: ["writer"], name: "Scribe", prompt: "Concise", palette: [] },
    );
    expect(result).toEqual({ kind: "cues", cues });
    expect(existsSync(cwd)).toBe(false);
    expect(AuthoredCues.safeParse({ ...cues, waiting: [] }).success).toBe(false);
  });
  it("keeps provider diagnostics out of authoring responses", async () => {
    const result = await authorProfile(
      {
        generate: async () => {
          throw new Error("sensitive provider detail");
        },
      },
      { kind: "prompt", roles: [], name: "Builder", prompt: "", palette: [] },
    );
    expect(result.kind).toBe("error");
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
});
