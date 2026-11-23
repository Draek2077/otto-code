import { expect, it } from "vitest";
import { isTerminalSymbol, terminalFontStack } from "./fonts";
it("retains custom text fonts and adds bundled symbol coverage", () => {
  expect(terminalFontStack("My Code Font", "monospace")).toBe(
    "My Code Font, OttoNerdSymbols, monospace",
  );
  expect(terminalFontStack(" ", "Menlo")).toBe("Menlo, OttoNerdSymbols, monospace");
  expect(terminalFontStack(undefined, "Consolas, monospace")).toBe(
    "Consolas, OttoNerdSymbols, monospace",
  );
});
it("selects symbol coverage only for Unicode private-use characters", () => {
  expect(["A", "한", "─", "😀", ""].map(isTerminalSymbol)).toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
  expect(["\ue0b0", "\uf120", "\u{f0001}", "\u{100001}"].map(isTerminalSymbol)).toEqual([
    true,
    true,
    true,
    true,
  ]);
});
