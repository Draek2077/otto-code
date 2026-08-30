import { describe, expect, test } from "vitest";
import {
  getParentAgentIdFromLabels,
  getOpenAgentTabLabel,
  getOrchestrationRunIdFromLabels,
  getScheduleRunSourceFromLabels,
  hasOpenAgentTab,
  isDelegatedAgent,
  isOpenAgentTabLabel,
  PARENT_AGENT_ID_LABEL,
  ORCHESTRATION_RUN_ID_LABEL,
  SCHEDULE_ID_LABEL,
  SCHEDULE_RUN_ID_LABEL,
} from "./agent-labels.js";

describe("agent label policy", () => {
  test("treats a non-empty parent agent label as delegation", () => {
    const labels = { [PARENT_AGENT_ID_LABEL]: " parent-agent \n" };

    expect(getParentAgentIdFromLabels(labels)).toBe("parent-agent");
    expect(isDelegatedAgent({ labels })).toBe(true);
  });

  test("ignores missing, empty, and non-string parent agent labels", () => {
    expect(isDelegatedAgent({ labels: {} })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: "   " } })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: 42 } })).toBe(false);
  });

  test("reads only a non-empty durable orchestration run label", () => {
    expect(getOrchestrationRunIdFromLabels({ [ORCHESTRATION_RUN_ID_LABEL]: " run_1 \n" })).toBe(
      "run_1",
    );
    expect(getOrchestrationRunIdFromLabels({ [ORCHESTRATION_RUN_ID_LABEL]: " " })).toBeNull();
    expect(getOrchestrationRunIdFromLabels({ [ORCHESTRATION_RUN_ID_LABEL]: 1 })).toBeNull();
  });

  test("reads a schedule provenance source only when both labels are valid", () => {
    expect(
      getScheduleRunSourceFromLabels({
        [SCHEDULE_ID_LABEL]: " schedule_1 ",
        [SCHEDULE_RUN_ID_LABEL]: " run_1 ",
      }),
    ).toEqual({ scheduleId: "schedule_1", runId: "run_1" });
    expect(getScheduleRunSourceFromLabels({ [SCHEDULE_ID_LABEL]: "schedule_1" })).toBeNull();
    expect(
      getScheduleRunSourceFromLabels({
        [SCHEDULE_ID_LABEL]: "schedule_1",
        [SCHEDULE_RUN_ID_LABEL]: " ",
      }),
    ).toBeNull();
  });

  test("treats any true client-scoped open-tab label as open", () => {
    const desktopLabel = getOpenAgentTabLabel("desktop-client");
    const mobileLabel = getOpenAgentTabLabel("mobile-client");

    expect(hasOpenAgentTab({ [desktopLabel]: "false", [mobileLabel]: "true" })).toBe(true);
    expect(hasOpenAgentTab({ [desktopLabel]: "false", [mobileLabel]: "false" })).toBe(false);
    expect(hasOpenAgentTab({})).toBe(false);
  });

  test("recognizes only client-scoped open-tab labels", () => {
    expect(isOpenAgentTabLabel(getOpenAgentTabLabel("client-a"))).toBe(true);
    expect(isOpenAgentTabLabel("paseo.open-agent-tab")).toBe(false);
    expect(isOpenAgentTabLabel("custom.open-agent-tab.client-a")).toBe(false);
  });
});
