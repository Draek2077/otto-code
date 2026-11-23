import { describe, expect, it } from "vitest";
import { extractSymbols } from "../symbols.js";

describe("extractSymbols", () => {
  it("returns an empty list for unsupported languages", () => {
    expect(extractSymbols("anything here", "notes.unknownext")).toEqual([]);
  });

  it("extracts function, class, and const definitions from TypeScript", () => {
    const code = [
      "const alpha = 1;",
      "function greet(name: string) {",
      "  return name;",
      "}",
      "class Widget {",
      "  render() {}",
      "}",
    ].join("\n");
    const symbols = extractSymbols(code, "src/app.ts");
    const byName = new Map(symbols.map((symbol) => [symbol.name, symbol]));

    expect(byName.get("greet")?.kind).toBe("function");
    expect(byName.get("greet")?.line).toBe(2);
    expect(byName.get("Widget")?.kind).toBe("class");
    expect(byName.get("Widget")?.line).toBe(5);
    expect(byName.has("alpha")).toBe(true);
  });

  it("captures definitions in declaration order", () => {
    const code = "function a() {}\nfunction b() {}\n";
    const symbols = extractSymbols(code, "x.js");
    const functionNames = symbols.filter((s) => s.kind === "function").map((s) => s.name);
    expect(functionNames).toEqual(["a", "b"]);
  });

  it("extracts Python def and class definitions", () => {
    const code = ["def compute(x):", "    return x", "", "class Model:", "    pass"].join("\n");
    const symbols = extractSymbols(code, "model.py");
    const names = symbols.map((s) => s.name);
    expect(names).toContain("compute");
    expect(names).toContain("Model");
  });
});
