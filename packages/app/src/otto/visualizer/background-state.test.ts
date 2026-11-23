import { afterEach, expect, it } from "vitest";
import { useVisualizerBackgroundState } from "./background-state";
afterEach(() => useVisualizerBackgroundState.getState().clear());
it("retains graph-only intent with a tab through draft conversion and inactive workspace eviction", () => {
  const state = useVisualizerBackgroundState.getState();
  state.setHidden("host:workspace:draft-tab", true);
  state.prune(new Set(["host:workspace:draft-tab", "host:another:tab"]));
  expect(useVisualizerBackgroundState.getState().hidden).toEqual({
    "host:workspace:draft-tab": true,
  });
});
it("clears only actually closed tabs and explicit restoration", () => {
  const state = useVisualizerBackgroundState.getState();
  state.setHidden("closed", true);
  state.setHidden("retained", true);
  state.prune(new Set(["retained"]));
  expect(useVisualizerBackgroundState.getState().hidden).toEqual({ retained: true });
  state.setHidden("retained", false);
  expect(useVisualizerBackgroundState.getState().hidden).toEqual({});
});
it("closes graph-only intent when background placement is closed", () => {
  const state = useVisualizerBackgroundState.getState();
  state.setHidden("tab", true);
  state.clear();
  expect(useVisualizerBackgroundState.getState().hidden).toEqual({});
});
