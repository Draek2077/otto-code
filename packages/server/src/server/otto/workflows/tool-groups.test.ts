import { describe, test, expect } from "vitest";
import { workflowToolGroupAllowed } from "./tool-groups.js";
describe("per-node tool group ceiling", () => {
  test("absence preserves existing authority; explicit empty removes capabilities", () => {
    expect(workflowToolGroupAllowed("read_project_knowledge", undefined)).toBe(true);
    expect(workflowToolGroupAllowed("read_project_knowledge", [])).toBe(false);
  });
  test("selecting Knowledge cannot grant unknown or unrelated capabilities", () => {
    expect(workflowToolGroupAllowed("read_project_knowledge", ["knowledge"])).toBe(true);
    expect(workflowToolGroupAllowed("create_artifact", ["knowledge"])).toBe(false);
    expect(workflowToolGroupAllowed("unknown_extension", ["knowledge"])).toBe(false);
  });
});
