import { it, expect } from "vitest";
import { contextReport, type InspectedContext } from "./report.js";

it("charges the prospective Profile brief to fixed tokens once and leaves actual chat inspection alone", () => {
  const graph = { sources: new Map(), edits: new Map(), nodes: [], edges: [], findings: [] };
  const selection = { hostId: "host", workspaceId: "workspace", agentId: null, windowTokens: 4000 };
  const input: InspectedContext = {
    provider: "Otto",
    visible: true,
    system: "",
    tools: null,
    prepared: null,
    blocks: [],
  };
  const base = contextReport(input, graph, selection).report;
  const profile = { ...input, profileBrief: "12345678901234567890" };
  const projected = contextReport(profile, graph, { ...selection, profileId: "profile" });
  expect(projected.sections.otto_injected).toBe(profile.profileBrief);
  expect(projected.report.fixedTokens).toBe(base.fixedTokens + 5);
  expect(projected.report.workingRoom).toBe(base.workingRoom - 5);
  expect(projected.report.revision).not.toBe(base.revision);
  const actual = contextReport(profile, graph, { ...selection, agentId: "chat" }).report;
  expect(actual.categories.find((c) => c.category === "otto_injected")?.estimatedTokens).toBeNull();
});
