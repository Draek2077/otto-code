import { describe, expect, it } from "vitest";
import { getStructuralDiffDemoScenario } from "./structural-diff-demo-scenarios";
import { evaluateStructuralSourcePair } from "./structural-diff-harness";
import { buildStructuralRenderPlan } from "./structural-render-plan";

function planForScenario(id: string) {
  const scenario = getStructuralDiffDemoScenario(id);
  const evaluation = evaluateStructuralSourcePair(scenario);
  return buildStructuralRenderPlan(evaluation.document);
}

function inlineText(row: ReturnType<typeof buildStructuralRenderPlan>["rows"][number]) {
  if (row.kind !== "inline-change") return null;
  return row.spans.map((span) => `${span.kind}:${span.text}`).join("|");
}

describe("structural render plan semantics", () => {
  it("keeps a nested HTML tag normal while its attribute value changes", () => {
    const plan = planForScenario("html");
    expect(plan.rows.map(inlineText)).toContain(
      'shared:<body class="|removed:foo|replacement-added:bar|shared:">',
    );
  });

  it("keeps surrounding HTML content normal around nested markup", () => {
    const plan = planForScenario("html");
    expect(plan.rows.map(inlineText)).toContain(
      "shared:  <p>Story about |removed:foo|replacement-added:<strong>bar</strong>|shared:.</p>",
    );
  });

  it("keeps list items normal when an insertion rewraps the collection", () => {
    const plan = planForScenario("nested-javascript");
    expect(plan.rows.map(inlineText)).toContain(
      'shared:  "john", "harry", "dick", "|removed:eric|replacement-added:yvonne|shared:",',
    );
    expect(plan.rows.map(inlineText)).toContain(
      'shared:  "|added:eric", "|shared:jenny", "alexandra",',
    );
  });

  it("keeps nested statements inline when a wrapper only changes indentation", () => {
    const plan = planForScenario("nested-javascript");
    expect(plan.rows.map(inlineText)).toContain("added:  |shared:foo();");
    expect(plan.rows.map(inlineText)).toContain(
      "added:  |shared:bar(|removed:1|replacement-added:2|shared:);",
    );
  });
});
