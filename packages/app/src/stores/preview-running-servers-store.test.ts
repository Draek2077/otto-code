import { beforeEach, describe, expect, it } from "vitest";

import { usePreviewRunningServersStore } from "./preview-running-servers-store";

describe("preview running servers store", () => {
  beforeEach(() => {
    usePreviewRunningServersStore.setState({ runningServerIdsBySessionAndCwd: {} });
  });

  it("records the running servers reported for a cwd", () => {
    usePreviewRunningServersStore
      .getState()
      .replaceRunningForCwd("server-a", "/repo", ["s1", "s2"]);

    expect(
      usePreviewRunningServersStore.getState().runningServerIdsBySessionAndCwd["server-a"]?.[
        "/repo"
      ],
    ).toEqual(new Set(["s1", "s2"]));
  });

  it("performs no write when a poll reports the same servers", () => {
    const { replaceRunningForCwd } = usePreviewRunningServersStore.getState();
    replaceRunningForCwd("server-a", "/repo", ["s1", "s2"]);
    const afterFirst = usePreviewRunningServersStore.getState().runningServerIdsBySessionAndCwd;

    // Order differs, contents don't - the 10s poll must not wake subscribers.
    replaceRunningForCwd("server-a", "/repo", ["s2", "s1"]);

    expect(usePreviewRunningServersStore.getState().runningServerIdsBySessionAndCwd).toBe(
      afterFirst,
    );
  });

  it("writes when the reported servers actually change", () => {
    const { replaceRunningForCwd } = usePreviewRunningServersStore.getState();
    replaceRunningForCwd("server-a", "/repo", ["s1"]);
    const afterFirst = usePreviewRunningServersStore.getState().runningServerIdsBySessionAndCwd;

    replaceRunningForCwd("server-a", "/repo", ["s1", "s2"]);
    const afterSecond = usePreviewRunningServersStore.getState().runningServerIdsBySessionAndCwd;
    expect(afterSecond).not.toBe(afterFirst);
    expect(afterSecond["server-a"]?.["/repo"]).toEqual(new Set(["s1", "s2"]));

    replaceRunningForCwd("server-a", "/repo", []);
    expect(
      usePreviewRunningServersStore.getState().runningServerIdsBySessionAndCwd["server-a"]?.[
        "/repo"
      ],
    ).toEqual(new Set());
  });

  it("leaves other cwds on the session untouched", () => {
    const { replaceRunningForCwd } = usePreviewRunningServersStore.getState();
    replaceRunningForCwd("server-a", "/repo", ["s1"]);
    replaceRunningForCwd("server-a", "/repo/worktree", ["s2"]);

    const byCwd =
      usePreviewRunningServersStore.getState().runningServerIdsBySessionAndCwd["server-a"];
    expect(byCwd?.["/repo"]).toEqual(new Set(["s1"]));
    expect(byCwd?.["/repo/worktree"]).toEqual(new Set(["s2"]));
  });
});
