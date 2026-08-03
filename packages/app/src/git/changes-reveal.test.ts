import { describe, expect, it } from "vitest";
import { resolveChangedPathSet } from "./changes-reveal";

function snapshot(...paths: string[]): { path: string }[] {
  return paths.map((path) => ({ path }));
}

describe("resolveChangedPathSet", () => {
  it("keeps the previous set identity when a new snapshot has the same membership", () => {
    const first = resolveChangedPathSet(snapshot("src/a.ts", "src/b.ts"), new Set<string>());
    // A fresh array of fresh objects — the shape every `checkout_diff_update`
    // push arrives in while an agent is editing files already in the diff.
    const second = resolveChangedPathSet(snapshot("src/a.ts", "src/b.ts"), first);

    expect(second).toBe(first);
    expect([...second]).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("ignores ordering when comparing membership", () => {
    const first = resolveChangedPathSet(snapshot("src/a.ts", "src/b.ts"), new Set<string>());
    const second = resolveChangedPathSet(snapshot("src/b.ts", "src/a.ts"), first);

    expect(second).toBe(first);
  });

  it("returns a new set when a path is added", () => {
    const first = resolveChangedPathSet(snapshot("src/a.ts"), new Set<string>());
    const second = resolveChangedPathSet(snapshot("src/a.ts", "src/b.ts"), first);

    expect(second).not.toBe(first);
    expect([...second]).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns a new set when a path is removed", () => {
    const first = resolveChangedPathSet(snapshot("src/a.ts", "src/b.ts"), new Set<string>());
    const second = resolveChangedPathSet(snapshot("src/a.ts"), first);

    expect(second).not.toBe(first);
    expect([...second]).toEqual(["src/a.ts"]);
  });

  it("returns a new set when a path is swapped, keeping the size equal", () => {
    const first = resolveChangedPathSet(snapshot("src/a.ts", "src/b.ts"), new Set<string>());
    const second = resolveChangedPathSet(snapshot("src/a.ts", "src/c.ts"), first);

    expect(second).not.toBe(first);
    expect([...second]).toEqual(["src/a.ts", "src/c.ts"]);
  });

  it("holds one identity across empty snapshots", () => {
    const first = resolveChangedPathSet([], new Set<string>());
    const second = resolveChangedPathSet([], first);

    expect(second).toBe(first);
    expect(second.size).toBe(0);
  });

  it("empties the set when the last changed file goes away", () => {
    const first = resolveChangedPathSet(snapshot("src/a.ts"), new Set<string>());
    const second = resolveChangedPathSet([], first);

    expect(second).not.toBe(first);
    expect(second.size).toBe(0);
  });
});
