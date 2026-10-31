import { z } from "zod";
import {
  wakePreferenceDefaults,
  wakeStoredPreferences,
  type WakePreferences,
} from "./wake/preferences";
export interface SpeechPreferences extends WakePreferences {
  voiceThinkingTone: boolean;
  voicePlaybackVolume: number;
  agentVoiceCues: boolean;
  agentVoiceCuesVolume: number;
  agentVoiceCuesMuted: boolean;
  agentAutoSpeechEnabled: Record<string, boolean>;
}
export const speechPreferenceDefaults: SpeechPreferences = {
  ...wakePreferenceDefaults,
  voiceThinkingTone: true,
  voicePlaybackVolume: 50,
  agentVoiceCues: true,
  agentVoiceCuesVolume: 50,
  agentVoiceCuesMuted: false,
  agentAutoSpeechEnabled: {},
};
// Preserve the 0.9 device keys and percent units; never turn a muted device on.
export const speechStoredPreferences = {
  ...wakeStoredPreferences,
  voiceThinkingTone: z.boolean().catch(true),
  voicePlaybackVolume: z.number().min(0).max(100).catch(50),
  agentVoiceCues: z.boolean().catch(true),
  agentVoiceCuesVolume: z.number().min(0).max(100).catch(50),
  agentVoiceCuesMuted: z.boolean().catch(false),
  agentAutoSpeechEnabled: z.record(z.string(), z.boolean()).catch({}),
};
export function speechAgentKey(serverId: string, agentId: string) {
  return `${serverId}:${agentId}`;
}
