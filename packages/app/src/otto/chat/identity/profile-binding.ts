import type { AgentProfile } from "@getpaseo/protocol/messages";
import type { SpinnerColors } from "./palette";

// Captured presentation metadata travels through Paseo's persisted, host-synced
// agent labels. It is never a provider feature, prompt, or inferred model match.
export const CHAT_PROFILE_LABEL = "otto.profile";
export interface ChatProfileBinding {
  id: string;
  name: string;
  spinner?: SpinnerColors;
  hostBinding?: boolean;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function spinnerColors(value: unknown): SpinnerColors | undefined {
  if (!record(value)) return undefined;
  if (typeof value.glowA !== "string" || !value.glowA.trim()) return undefined;
  if (typeof value.glowB !== "string" || !value.glowB.trim()) return undefined;
  return { glowA: value.glowA, glowB: value.glowB };
}
export function captureChatProfile(profile: AgentProfile): ChatProfileBinding {
  const spinner = spinnerColors(profile.spinner);
  return { id: profile.id, name: profile.name, ...(spinner ? { spinner } : {}) };
}
export function chatProfileLabels(
  binding?: ChatProfileBinding | null,
): Record<string, string> | undefined {
  return binding
    ? {
        [CHAT_PROFILE_LABEL]: JSON.stringify(binding),
        ...(binding.hostBinding ? { "otto.selectProfile": binding.id } : {}),
      }
    : undefined;
}
export function restoreDraftChatProfile(
  setup: { provider: string; labels?: Record<string, string> } | null,
) {
  if (!setup) return null;
  const binding = readChatProfile(setup.labels?.[CHAT_PROFILE_LABEL]);
  return binding ? { provider: setup.provider, binding } : null;
}
export function creationChatProfileLabels(
  pending: { labels?: Record<string, string> } | null,
  binding?: ChatProfileBinding,
) {
  if (pending) return pending.labels;
  return chatProfileLabels(binding);
}
export function normalizeDraftAgentLabels(value: unknown): Record<string, string> | undefined {
  if (!record(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
export function readChatProfile(serialized: string | undefined): ChatProfileBinding | null {
  if (!serialized) return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!record(value) || typeof value.id !== "string" || !value.id || typeof value.name !== "string")
    return null;
  const spinner = spinnerColors(value.spinner);
  return {
    id: value.id,
    name: value.name,
    ...(value.hostBinding === true ? { hostBinding: true } : {}),
    ...(spinner ? { spinner } : {}),
  };
}
