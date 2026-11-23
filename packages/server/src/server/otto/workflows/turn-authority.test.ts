import { describe, test, expect } from "vitest";
import {
  assertWorkflowTurn,
  assertWorkflowInteractiveControl,
  workflowTurnOptions,
} from "./turn-authority.js";
import { WORKFLOW_RUN_LABEL } from "./labels.js";
const ordinary = { id: "ordinary", labels: {} };
const worker = {
  id: "worker",
  labels: { [WORKFLOW_RUN_LABEL]: "run" },
  owner: {
    kind: "daemon" as const,
    daemonId: "host",
    executionId: "otto-workflow:run:worker:worker",
  },
};
describe("Workflow-only turn capability", () => {
  test("ordinary Paseo admission/options/control are untouched", () => {
    const options = { maxThinkingTokens: 1024 };
    expect(() => assertWorkflowTurn(ordinary, options)).not.toThrow();
    expect(() => assertWorkflowTurn(ordinary, undefined, "execute")).not.toThrow();
    expect(() => assertWorkflowInteractiveControl(ordinary)).not.toThrow();
    expect(options).toEqual({ maxThinkingTokens: 1024 });
  });
  test("untrusted options and serialized copies never grant worker authority", () => {
    expect(() => assertWorkflowTurn(worker, {})).toThrow("owning run");
    const grant = workflowTurnOptions(worker.id, () => true);
    expect(() => assertWorkflowTurn(worker, JSON.parse(JSON.stringify(grant)))).toThrow();
    expect(grant).toEqual({});
  });
  test("a grant admits once, permits execution only while live, and cannot cross agents", () => {
    let active = true;
    const options = workflowTurnOptions(worker.id, () => active);
    expect(() => assertWorkflowTurn({ ...worker, id: "other" }, options)).toThrow();
    expect(() => assertWorkflowTurn(worker, options, "execute")).toThrow();
    assertWorkflowTurn(worker, options);
    assertWorkflowTurn(worker, options, "execute");
    expect(() => assertWorkflowTurn(worker, options)).toThrow();
    active = false;
    expect(() => assertWorkflowTurn(worker, options, "execute")).toThrow();
  });
  test("persistent owner still fences a worker after labels are cleared or runtime restarts", () => {
    expect(() => assertWorkflowTurn({ ...worker, labels: {} }, undefined)).toThrow();
    expect(() => assertWorkflowInteractiveControl({ ...worker, labels: {} })).toThrow();
  });
  test("a dedicated conductor keeps ordinary chat admission for planning questions", () => {
    const conductor = {
      ...worker,
      labels: {},
      owner: { ...worker.owner, executionId: "otto-workflow:run:root:conductor" },
    };
    expect(() => assertWorkflowTurn(conductor, undefined)).not.toThrow();
    expect(() => assertWorkflowInteractiveControl(conductor)).not.toThrow();
    expect(() => assertWorkflowTurn(conductor, undefined, "admit", true)).toThrow();
    expect(() => assertWorkflowInteractiveControl(conductor, true)).toThrow();
    const options = workflowTurnOptions(conductor.id, () => true);
    expect(() => assertWorkflowTurn(conductor, options, "admit", true)).not.toThrow();
  });
});
