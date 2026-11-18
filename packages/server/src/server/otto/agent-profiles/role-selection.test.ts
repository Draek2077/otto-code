import { expect, it } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { roleResolver, scheduleProfile } from "./role-selection.js";
const profiles = [
  {
    id: "one",
    name: "First",
    provider: "mock",
    model: "a",
    roles: ["scheduler", "artificer"],
    personalityPrompt: "First prompt",
  },
  { id: "two", name: "Second", provider: "mock", model: "b", roles: ["scheduler"] },
];
const teams = [
  { id: "red", name: "Red", teamPrompt: "Team red", memberIds: ["one"] },
  { id: "blue", name: "Blue", memberIds: ["two"] },
];
const catalog: ProviderSnapshotEntry = {
  provider: "mock",
  enabled: true,
  status: "ready",
  models: ["a", "b"].map((id) => ({ id, label: id })),
  modes: [],
};
it("resolves a dynamic seat at each fire and retains an explicitly pinned Scheduler", async () => {
  let activeTeamId = "red";
  const resolve = roleResolver(
    () => ({ agentProfiles: profiles, agentTeams: { teams, activeTeamId } }),
    async () => catalog,
  );
  const config = { provider: "mock", cwd: ".", model: "a", agentProfile: "@team-scheduler" };
  const red = await scheduleProfile(config, resolve);
  expect(red.binding?.prompt).toBe("Team red\n\nFirst prompt");
  activeTeamId = "blue";
  expect((await scheduleProfile(config, resolve)).config.model).toBe("b");
  expect(red.config.model).toBe("a");
  expect((await scheduleProfile({ ...config, agentProfile: "one" }, resolve)).binding?.id).toBe(
    "one",
  );
  await expect(resolve("artificer", "two", ".")).rejects.toThrow();
});
it("keeps the raw config and refuses a missing Team role before spawning", async () => {
  const config = { provider: "mock", model: "a", cwd: "." };
  expect(await scheduleProfile(config)).toEqual({ config });
  const resolve = roleResolver(
    () => ({ agentProfiles: profiles }),
    async () => catalog,
  );
  await expect(
    scheduleProfile({ ...config, personality: "@team-scheduler" }, resolve),
  ).rejects.toThrow("active Team");
});

it("reads a legacy name and skips an unavailable member when the Team owns the seat", async () => {
  const resolve = roleResolver(
    () => ({
      agentProfiles: [{ ...profiles[0], modeId: "gone" }, profiles[1]],
      agentTeams: {
        activeTeamId: "pair",
        teams: [{ id: "pair", name: "Pair", memberIds: ["one", "two"] }],
      },
    }),
    async () => catalog,
  );
  const config = { provider: "mock", cwd: "." };
  expect((await scheduleProfile({ ...config, personality: "Second" }, resolve)).binding?.id).toBe(
    "two",
  );
  await expect(scheduleProfile({ ...config, agentProfile: "Second" }, resolve)).rejects.toThrow();
  expect(
    (await scheduleProfile({ ...config, agentProfile: "@team-scheduler" }, resolve)).binding?.id,
  ).toBe("two");
});
