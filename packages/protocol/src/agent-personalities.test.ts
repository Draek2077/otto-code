import { describe, expect, test } from "vitest";

import {
  composeRoleFocusDirective,
  personalityCanLaunch,
  summarizePersonalityForSelection,
} from "./agent-personalities.js";

describe("personality role tiers", () => {
  test("only the surface + conductor roles can launch", () => {
    expect(personalityCanLaunch({ roles: ["chatter"] })).toBe(true);
    expect(personalityCanLaunch({ roles: ["orchestrator"] })).toBe(true);
    expect(personalityCanLaunch({ roles: ["artificer"] })).toBe(true);
    expect(personalityCanLaunch({ roles: ["scheduler"] })).toBe(true);
  });

  test("a personality whose roles are entirely focused cannot launch", () => {
    // advisor is read-only now (was wrongly coordinator-tier); the new
    // thinking/making roles are focused too.
    expect(personalityCanLaunch({ roles: ["advisor"] })).toBe(false);
    expect(personalityCanLaunch({ roles: ["researcher"] })).toBe(false);
    expect(personalityCanLaunch({ roles: ["planner"] })).toBe(false);
    expect(personalityCanLaunch({ roles: ["designer"] })).toBe(false);
    expect(personalityCanLaunch({ roles: ["writer"] })).toBe(false);
    expect(personalityCanLaunch({ roles: ["coder"] })).toBe(false);
    expect(personalityCanLaunch({ roles: ["judger"] })).toBe(false);
    expect(personalityCanLaunch({ roles: ["writer", "coder", "judger"] })).toBe(false);
  });

  test("any coordinator role in a mixed set makes it a coordinator", () => {
    // Sprocket-style chatter+coder both codes and delegates.
    expect(personalityCanLaunch({ roles: ["coder", "chatter"] })).toBe(true);
    expect(summarizePersonalityForSelection({ roles: ["coder", "chatter"] }).tier).toBe(
      "coordinator",
    );
  });

  test("unknown roles cannot acquire coordinator privileges", () => {
    expect(personalityCanLaunch({ roles: ["unknown-role"] })).toBe(false);
  });

  test("a roleless personality defaults to focused and cannot launch", () => {
    expect(personalityCanLaunch({ roles: [] })).toBe(false);
    expect(summarizePersonalityForSelection({ roles: undefined }).tier).toBe("focused");
  });
});

describe("summarizePersonalityForSelection", () => {
  test("joins per-role guidance into one blurb", () => {
    const summary = summarizePersonalityForSelection({ roles: ["judger"] });
    expect(summary.canLaunch).toBe(false);
    expect(summary.tier).toBe("focused");
    expect(summary.guidance).toContain("Review specialist");
  });
});

describe("composeRoleFocusDirective", () => {
  test("the orchestrator gets the conductor method directive", () => {
    const directive = composeRoleFocusDirective(["orchestrator"]);
    expect(directive).toContain("sole conductor");
    expect(directive).toContain("start_orchestration");
    expect(directive).toContain("Choose tools because the task needs their specific capability");
    expect(directive).toContain("Use create_chat only");
    expect(directive).toContain("Use suggest_task only");
    expect(directive).not.toContain("Prefer start_orchestration");
  });

  test("a non-orchestrator coordinator gets the lighter delegate nudge", () => {
    const directive = composeRoleFocusDirective(["chatter"]);
    expect(directive).toContain("coordinator");
    expect(directive).toContain("do the work directly");
    expect(directive).toContain("hand off genuinely multi-chat work to the team's orchestrator");
    expect(directive).not.toContain("start_orchestration");
  });

  test("focused personalities are told to stay on task", () => {
    const directive = composeRoleFocusDirective(["coder"]);
    expect(directive).toContain("focused personality");
    expect(directive).toContain("stay on it");
    expect(directive).toContain("don't create child chats");
  });

  test("the reclassified advisor gets the focused-personality directive", () => {
    const directive = composeRoleFocusDirective(["advisor"]);
    expect(directive).toContain("focused personality");
    expect(directive).toContain("don't create child chats");
  });

  test("roleless spawns get no directive", () => {
    expect(composeRoleFocusDirective(undefined)).toBeUndefined();
    expect(composeRoleFocusDirective([])).toBeUndefined();
  });
});
