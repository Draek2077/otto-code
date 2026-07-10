import { describe, expect, test } from "vitest";
import { fuzzyFilter } from "./fuzzy-match";

const identity = (value: string) => value;

describe("fuzzyFilter", () => {
  test("matches subsequences and drops non-matches", () => {
    const files = ["src/app.ts", "src/components/button.tsx", "readme.md"];
    const result = fuzzyFilter(files, "appts", identity);
    expect(result.map((match) => match.item)).toEqual(["src/app.ts"]);
  });

  test("ranks basename and segment-boundary matches above scattered ones", () => {
    const files = ["packages/button-group/index.ts", "src/button.tsx", "docs/abutment.md"];
    const result = fuzzyFilter(files, "button", identity);
    expect(result[0].item).toBe("src/button.tsx");
  });

  test("an empty query keeps every item", () => {
    const files = ["a.ts", "b.ts"];
    expect(fuzzyFilter(files, "", identity)).toHaveLength(2);
  });

  test("is case-insensitive and returns highlight positions", () => {
    const result = fuzzyFilter(["MyWidget.tsx"], "mw", identity);
    expect(result).toHaveLength(1);
    expect(result[0].positions).toEqual([0, 2]);
  });

  test("respects the result limit", () => {
    const files = Array.from({ length: 50 }, (_, index) => `file${index}.ts`);
    expect(fuzzyFilter(files, "file", identity, 10)).toHaveLength(10);
  });
});
