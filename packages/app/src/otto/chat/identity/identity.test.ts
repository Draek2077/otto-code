import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CHAT_STATUS_ARTWORK } from "./artwork";
import { chatSpinnerColors, workspaceActivityBlue } from "./palette";
import { isAttentionBucket, statusGlyph, statusGlyphColor } from "./status";
import { motionFrame, motionKeyframes } from "./motion";
import { AgentProfileSchema } from "@getpaseo/protocol/messages";
import {
  materializeAgentProfile,
  toAgentConfigApply,
} from "@/agent-profiles/internal/materialize-profile";
import { normalizeWorkspaceDraftTabSetup } from "@/workspace-tabs/identity";
import { mergeEditedProfile } from "@/otto/agent-profiles/edits";
import {
  captureChatProfile,
  CHAT_PROFILE_LABEL,
  chatProfileLabels,
  readChatProfile,
  restoreDraftChatProfile,
  creationChatProfileLabels,
} from "./profile-binding";

describe("released Otto chat identity", () => {
  it.each([
    ["Siren", "2f4d49069fe71c641c81407ee937bcc575d783708a80c1e2761366d1ffae32b0"],
    ["SirenQuestion", "463dcb3eec7c697f24a5c0c21b42c34073ff96cdb59f29aaa2d806f801b41be7"],
    ["Error", "ef7245baad73f28096bcc06572959edaba1cc737cddcf6ddee0951d66580867a"],
  ] as const)("preserves the v0.9.35 %s artwork byte-for-byte", (name, digest) => {
    expect(createHash("sha256").update(CHAT_STATUS_ARTWORK[name]).digest("hex")).toBe(digest);
  });
  it.each([
    ["needs_input", "SirenQuestion", "#f59e0b"],
    ["failed", "Error", "#ef4444"],
    ["attention", "Siren", "#22c55e"],
  ] as const)("maps %s to its released glyph and notify color", (bucket, glyph, color) => {
    expect(isAttentionBucket(bucket)).toBe(true);
    expect(statusGlyph(bucket)).toBe(glyph);
    expect(statusGlyphColor(bucket)).toBe(color);
  });
  it.each([null, undefined, "running", "done"])(
    "leaves %s without an attention badge",
    (bucket) => {
      expect(isAttentionBucket(bucket)).toBe(false);
    },
  );
  it("preserves the two orbit speeds, four wobble cycles and seamless 5.6s loop", () => {
    expect(motionFrame("spin-a", 2800).rotate).toBe(360);
    expect(motionFrame("spin-b", 2800).rotate).toBe(540);
    expect(motionFrame("spin-a", 5600).rotate).toBe(0);
    expect(motionFrame("wobble", 350).scaleX).toBeCloseTo(1.045);
    expect(motionFrame("wobble", 350).scaleY).toBeCloseTo(0.955);
    expect(motionFrame("wobble", 1750)).toEqual(motionFrame("wobble", 350));
  });
  it("keeps the notify halo at the released pulse bounds", () => {
    expect(motionFrame("halo", 0)).toMatchObject({ opacity: 0.68, scaleX: 0.9 });
    expect(motionFrame("halo", 1500)).toMatchObject({ opacity: 1, scaleX: 1 });
    expect(motionFrame("halo", 3000)).toEqual(motionFrame("halo", 0));
    expect(motionKeyframes("halo").timing).toMatchObject({
      duration: 1500,
      direction: "alternate",
    });
  });
  it("uses the released default theme pairs without modifying the base themes", () => {
    expect(chatSpinnerColors("light")).toEqual({ glowA: "#c69700", glowB: "#0d8ede" });
    expect(chatSpinnerColors("dark")).toEqual({ glowA: "#79b3f2", glowB: "#f591b5" });
    expect(chatSpinnerColors("darkClaude")).toEqual({ glowA: "#ff9866", glowB: "#ffd07e" });
    expect(chatSpinnerColors(undefined)).toEqual(chatSpinnerColors("dark"));
  });
  it("keeps workspace activity blue in both theme modes, independently of Profile colors", () => {
    expect(workspaceActivityBlue(false)).toBe("#0284c7");
    expect(workspaceActivityBlue(true)).toBe("#38bdf8");
  });
  it("distinguishes explicitly selected Profiles that use the same provider and model", () => {
    const first = AgentProfileSchema.parse({
      id: "writer",
      name: "Writer",
      provider: "codex",
      model: "same-model",
      spinner: { glowA: "#123456", glowB: "#abcdef" },
    });
    const second = AgentProfileSchema.parse({
      ...first,
      id: "reviewer",
      name: "Reviewer",
      spinner: { glowA: "#ff0000", glowB: "#00ff00" },
    });
    expect(materializeAgentProfile(first).chatProfile).toEqual({
      id: "writer",
      name: "Writer",
      spinner: first.spinner,
    });
    expect(materializeAgentProfile(second).chatProfile).toEqual({
      id: "reviewer",
      name: "Reviewer",
      spinner: second.spinner,
    });
    expect(toAgentConfigApply(materializeAgentProfile(first))).toEqual({ modelId: "same-model" });
  });
  it("retains captured colors through persisted draft normalization and a creation retry", () => {
    const profile = AgentProfileSchema.parse({
      id: "id",
      name: "Original name",
      provider: "custom-provider",
      spinner: { glowA: "#123456", glowB: "#abcdef" },
    });
    const labels = chatProfileLabels(captureChatProfile(profile));
    const setup = normalizeWorkspaceDraftTabSetup(
      JSON.parse(JSON.stringify({ provider: profile.provider, cwd: "/repo", labels })),
    );
    expect(restoreDraftChatProfile(setup ?? null)).toEqual({
      provider: profile.provider,
      binding: captureChatProfile(profile),
    });
    expect(
      readChatProfile(creationChatProfileLabels({ labels: setup?.labels })?.[CHAT_PROFILE_LABEL]),
    ).toEqual(captureChatProfile(profile));
    expect(creationChatProfileLabels({}, captureChatProfile(profile))).toBeUndefined();
  });
  it("uses default colors for a Profile with no complete custom pair and never guesses an assignment", () => {
    const profile = AgentProfileSchema.parse({
      id: "plain",
      name: "Plain",
      provider: "codex",
      spinner: { glowA: "#123456" },
    });
    expect(captureChatProfile(profile)).toEqual({ id: "plain", name: "Plain" });
    expect(chatProfileLabels(null)).toBeUndefined();
    expect(readChatProfile(undefined)).toBeNull();
    expect(readChatProfile("broken")).toBeNull();
    expect(readChatProfile('{"provider":"codex","model":"same-model"}')).toBeNull();
  });
  it("preserves saved Otto Profile fields while allowing the basic editor to clear optional settings", () => {
    const before = AgentProfileSchema.parse({
      id: "same-id",
      name: "Before",
      provider: "codex",
      model: "old-model",
      icon: "old-icon",
      notes: "old-notes",
      roles: ["coder", "reviewer"],
      spinner: { glowA: "#123456", glowB: "#abcdef" },
      personalityPrompt: "Keep my instructions",
      voice: { provider: "voice", voice: "original" },
      memoryEnabled: false,
    });
    const saved = mergeEditedProfile(before, { name: "After", provider: "codex" });
    expect(saved).toEqual({
      id: "same-id",
      name: "After",
      provider: "codex",
      roles: before.roles,
      spinner: before.spinner,
      personalityPrompt: before.personalityPrompt,
      voice: before.voice,
      memoryEnabled: false,
    });
    expect(captureChatProfile(saved)).toEqual({
      id: "same-id",
      name: "After",
      spinner: before.spinner,
    });
  });
});
