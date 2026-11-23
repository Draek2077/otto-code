import { test, expect } from "vitest";
import { WorkflowsScreen, WorkflowsWorkspace, WorkflowsSettings } from "./bridge";

// This import runs through the app's actual classic JSX unit transform. The trusted plugin
// module registry loads the bridge before a host or React tree exists; eager loading UI must be safe.
test("the trusted Workflow bridge loads before host selection without mounting lazy surfaces", () => {
  expect(
    [WorkflowsScreen, WorkflowsWorkspace, WorkflowsSettings].every(
      (component) => typeof component === "function",
    ),
  ).toBe(true);
});
