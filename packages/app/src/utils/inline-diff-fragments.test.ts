import { describe, expect, it } from "vitest";
import {
  buildIndentationAwareInlineLineFragments,
  buildInlineDiffFragments,
  buildInlineLineFragments,
} from "./inline-diff-fragments";

describe("inline diff fragments", () => {
  it("leaves the unchanged identifier prefix normal for a rename", () => {
    expect(buildInlineDiffFragments("formatPrice", "formatAmount")).toEqual([
      { kind: "shared", text: "format" },
      { kind: "removed", text: "Price" },
      { kind: "added", text: "Amount" },
    ]);
  });

  it("preserves the unchanged surrounding code for a compact replacement", () => {
    const fragments = buildInlineDiffFragments("return label;", "return formatted;");
    expect(fragments).toEqual([
      { kind: "shared", text: "return " },
      { kind: "removed", text: "label" },
      { kind: "added", text: "formatted" },
      { kind: "shared", text: ";" },
    ]);
    expect(
      fragments
        .filter((fragment) => fragment.kind !== "added")
        .map((fragment) => fragment.text)
        .join(""),
    ).toBe("return label;");
    expect(
      fragments
        .filter((fragment) => fragment.kind !== "removed")
        .map((fragment) => fragment.text)
        .join(""),
    ).toBe("return formatted;");
  });

  it("refines production word segments down to the changed identifier suffix", () => {
    expect(
      buildInlineLineFragments(
        [
          { text: "export function ", changed: false },
          { text: "formatPrice", changed: true },
          { text: "(cents: number): string {", changed: false },
        ],
        [
          { text: "export function ", changed: false },
          { text: "formatAmount", changed: true },
          { text: "(cents: number): string {", changed: false },
        ],
        "export function formatPrice(cents: number): string {",
        "export function formatAmount(cents: number): string {",
      ),
    ).toEqual([
      { kind: "shared", text: "export function format" },
      { kind: "removed", text: "Price" },
      { kind: "replacement-added", text: "Amount" },
      { kind: "shared", text: "(cents: number): string {" },
    ]);
  });

  it("keeps a type annotation green when it is added beside a token rename", () => {
    expect(
      buildInlineLineFragments(
        [
          { text: "export function ", changed: false },
          { text: "formatPrice", changed: true },
          { text: "(cents: number", changed: false },
          { text: ") {", changed: true },
        ],
        [
          { text: "export function ", changed: false },
          { text: "formatAmount", changed: true },
          { text: "(cents: number", changed: false },
          { text: "): string {", changed: true },
        ],
        "export function formatPrice(cents: number) {",
        "export function formatAmount(cents: number): string {",
      ),
    ).toEqual([
      { kind: "shared", text: "export function format" },
      { kind: "removed", text: "Price" },
      { kind: "replacement-added", text: "Amount" },
      { kind: "shared", text: "(cents: number)" },
      { kind: "added", text: ": string" },
      { kind: "shared", text: " {" },
    ]);
  });

  it("keeps wrapped statements together when only their indentation changes", () => {
    expect(
      buildIndentationAwareInlineLineFragments(undefined, undefined, "bar(1);", "  bar(2);"),
    ).toEqual([
      { kind: "added", text: "  " },
      { kind: "shared", text: "bar(" },
      { kind: "removed", text: "1" },
      { kind: "replacement-added", text: "2" },
      { kind: "shared", text: ");" },
    ]);
  });

  it("rejects malformed producer segments rather than losing source characters", () => {
    expect(
      buildInlineLineFragments(
        [
          { text: "    <title>Hi", changed: false },
          { text: "!</title>", changed: true },
        ],
        [
          { text: "    <title>Hi", changed: false },
          { text: "</title>", changed: true },
        ],
        "    <title>Hi!</title>",
        "    <title>Hi</title>",
      ),
    ).toEqual([
      { kind: "shared", text: "    <title>Hi" },
      { kind: "removed", text: "!" },
      { kind: "shared", text: "</title>" },
    ]);
  });
});
