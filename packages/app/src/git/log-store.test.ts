import { describe, expect, test } from "vitest";
import { buildGitLogKey, useGitLogStore } from "./log-store";

describe("git operation log store", () => {
  test("merges live entries under the workspace log key", () => {
    const input = {
      serverId: "server",
      cwd: "/repo",
      operation: "commit",
      entries: [{ seq: 1, timestamp: "now", level: "info" as const, text: "created commit" }],
    };

    useGitLogStore.setState({
      entriesByKey: {},
      mergeEntries: useGitLogStore.getState().mergeEntries,
    });
    useGitLogStore.getState().mergeEntries(input);

    expect(useGitLogStore.getState().entriesByKey[buildGitLogKey(input)]).toEqual(input.entries);
  });
});
