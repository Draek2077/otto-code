import { describe, expect, it } from "vitest";
import { removeAgentsFromHistoryPayload } from "./use-delete-agent";

describe("removeAgentsFromHistoryPayload", () => {
  const payload = {
    pages: [
      {
        agents: [
          { id: "a", serverId: "h1" },
          { id: "b", serverId: "h1" },
        ],
      },
      { agents: [{ id: "c", serverId: "h2" }] },
    ],
  };

  it("removes the named rows from the page that holds them", () => {
    const next = removeAgentsFromHistoryPayload(payload, { serverId: "h1", agentIds: ["a"] });
    expect(next.pages[0]!.agents).toEqual([{ id: "b", serverId: "h1" }]);
    // Untouched pages keep referential identity so react-query skips re-renders.
    expect(next.pages[1]).toBe(payload.pages[1]);
  });

  it("never removes a row belonging to another host", () => {
    const next = removeAgentsFromHistoryPayload(payload, { serverId: "h1", agentIds: ["c"] });
    expect(next).toBe(payload);
  });

  it("treats a row with no serverId as belonging to the requested host", () => {
    const single = { pages: [{ agents: [{ id: "a" }] }] };
    const next = removeAgentsFromHistoryPayload(single, { serverId: "h1", agentIds: ["a"] });
    expect(next.pages[0]!.agents).toEqual([]);
  });

  it("removes many ids in one pass, across pages", () => {
    const multiHostPayload = {
      pages: [{ agents: [{ id: "a" }, { id: "b" }] }, { agents: [{ id: "c" }, { id: "d" }] }],
    };
    const next = removeAgentsFromHistoryPayload(multiHostPayload, {
      serverId: "h1",
      agentIds: ["a", "d"],
    });
    expect(next.pages[0]!.agents).toEqual([{ id: "b" }]);
    expect(next.pages[1]!.agents).toEqual([{ id: "c" }]);
  });

  it("is a no-op for an empty id list, undefined payload, or missing pages", () => {
    expect(removeAgentsFromHistoryPayload(payload, { serverId: "h1", agentIds: [] })).toBe(payload);
    expect(
      removeAgentsFromHistoryPayload(undefined, { serverId: "h1", agentIds: ["a"] }),
    ).toBeUndefined();
    const pageless = {};
    expect(removeAgentsFromHistoryPayload(pageless, { serverId: "h1", agentIds: ["a"] })).toBe(
      pageless,
    );
  });

  it("leaves a page whose agents array is missing alone", () => {
    const odd = { pages: [{}, { agents: [{ id: "a" }] }] };
    const next = removeAgentsFromHistoryPayload(odd, { serverId: "h1", agentIds: ["a"] });
    expect(next.pages[0]).toBe(odd.pages[0]);
    expect(next.pages[1]!.agents).toEqual([]);
  });
});
