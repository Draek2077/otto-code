import { describe, expect, it, test } from "vitest";

import {
  composeRoleFocusDirective,
  findProfileByRef,
  profileCanLaunch,
  summarizeProfileForSelection,
} from "./agent-profiles.js";

describe("personality role tiers", () => {
  test("only the surface + conductor roles can launch", () => {
    expect(profileCanLaunch({ roles: ["chatter"] })).toBe(true);
    expect(profileCanLaunch({ roles: ["orchestrator"] })).toBe(true);
    expect(profileCanLaunch({ roles: ["artificer"] })).toBe(true);
    expect(profileCanLaunch({ roles: ["scheduler"] })).toBe(true);
  });

  test("a personality whose roles are entirely focused cannot launch", () => {
    // advisor is read-only now (was wrongly coordinator-tier); the new
    // thinking/making roles are focused too.
    expect(profileCanLaunch({ roles: ["advisor"] })).toBe(false);
    expect(profileCanLaunch({ roles: ["researcher"] })).toBe(false);
    expect(profileCanLaunch({ roles: ["planner"] })).toBe(false);
    expect(profileCanLaunch({ roles: ["designer"] })).toBe(false);
    expect(profileCanLaunch({ roles: ["writer"] })).toBe(false);
    expect(profileCanLaunch({ roles: ["coder"] })).toBe(false);
    expect(profileCanLaunch({ roles: ["judger"] })).toBe(false);
    expect(profileCanLaunch({ roles: ["writer", "coder", "judger"] })).toBe(false);
  });

  test("any coordinator role in a mixed set makes it a coordinator", () => {
    // Sprocket-style chatter+coder both codes and delegates.
    expect(profileCanLaunch({ roles: ["coder", "chatter"] })).toBe(true);
    expect(summarizeProfileForSelection({ roles: ["coder", "chatter"] }).tier).toBe("coordinator");
  });

  test("unknown roles cannot acquire coordinator privileges", () => {
    expect(profileCanLaunch({ roles: ["unknown-role"] })).toBe(false);
  });

  test("a roleless personality defaults to focused and cannot launch", () => {
    expect(profileCanLaunch({ roles: [] })).toBe(false);
    expect(summarizeProfileForSelection({ roles: undefined }).tier).toBe("focused");
  });
});

describe("summarizeProfileForSelection", () => {
  test("joins per-role guidance into one blurb", () => {
    const summary = summarizeProfileForSelection({ roles: ["judger"] });
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

describe("findProfileByRef", () => {
  const roster = [
    { id: "p-sage-01", name: "Sage" },
    { id: "p-atlas-02", name: "Atlas" },
    { id: "p-echo-03", name: "sage" },
  ];

  it("finds by stable id", () => {
    expect(findProfileByRef(roster, "p-atlas-02")?.name).toBe("Atlas");
  });

  it("finds by exact display name", () => {
    expect(findProfileByRef(roster, "Sage")?.id).toBe("p-sage-01");
  });

  it("prefers an exact name over a differently-cased one", () => {
    // Two entries differ only by case. An exact match must never be beaten by
    // the case-insensitive fallback, or the pick becomes roster-order-dependent.
    expect(findProfileByRef(roster, "sage")?.id).toBe("p-echo-03");
  });

  it("falls back to a case-insensitive name match", () => {
    expect(findProfileByRef(roster, "ATLAS")?.id).toBe("p-atlas-02");
  });

  it("prefers an id over a name that collides with it", () => {
    // Ids are opaque and unique, so an id match is never the ambiguous one.
    const colliding = [
      { id: "p-one", name: "p-two" },
      { id: "p-two", name: "Two" },
    ];
    expect(findProfileByRef(colliding, "p-two")?.id).toBe("p-two");
  });

  it("trims the reference", () => {
    expect(findProfileByRef(roster, "  Atlas  ")?.id).toBe("p-atlas-02");
  });

  it("returns undefined for an empty or unknown reference", () => {
    expect(findProfileByRef(roster, "   ")).toBeUndefined();
    expect(findProfileByRef(roster, "Ghost")).toBeUndefined();
  });
});
