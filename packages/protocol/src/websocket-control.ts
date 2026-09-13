import { z } from "zod";
import { CLIENT_CAPS } from "./client-capabilities.js";
import { BrowserAutomationHostCapabilitySchema } from "./browser-automation/capabilities.js";

export const WSPingMessageSchema = z.object({
  type: z.literal("ping"),
});

export const WSPongMessageSchema = z.object({
  type: z.literal("pong"),
});

export const WSHelloMessageSchema = z.object({
  type: z.literal("hello"),
  clientId: z.string().min(1),
  clientType: z.enum(["mobile", "browser", "cli", "mcp", "hub"]),
  protocolVersion: z.number().int(),
  appVersion: z.string().optional(),
  capabilities: z
    .object({
      voice: z.boolean().optional(),
      pushNotifications: z.boolean().optional(),
      [CLIENT_CAPS.explicitEventSubscriptions]: z.boolean().optional(),
      [CLIENT_CAPS.allProviders]: z.boolean().optional(),
      [CLIENT_CAPS.reasoningMergeEnum]: z.boolean().optional(),
      [CLIENT_CAPS.selectiveAgentTimeline]: z.boolean().optional(),
      [CLIENT_CAPS.customModeIcons]: z.boolean().optional(),
      [CLIENT_CAPS.terminalReflowableSnapshot]: z.boolean().optional(),
      [CLIENT_CAPS.providerSubagents]: z.boolean().optional(),
      [CLIENT_CAPS.projectUpdates]: z.boolean().optional(),
      [CLIENT_CAPS.compactProviderSnapshots]: z.boolean().optional(),
      [CLIENT_CAPS.providerSnapshotReferences]: z.boolean().optional(),
      [CLIENT_CAPS.timelineReplacementInvalidation]: z.boolean().optional(),
      [CLIENT_CAPS.timelineNotifications]: z.boolean().optional(),
      [CLIENT_CAPS.pluginTimelineItems]: z.boolean().optional(),
      [CLIENT_CAPS.workspaceSetupBlocked]: z.boolean().optional(),
      [CLIENT_CAPS.browserHost]: BrowserAutomationHostCapabilitySchema.optional(),
    })
    .passthrough()
    .optional(),
});

export const WSRecordingStateMessageSchema = z.object({
  type: z.literal("recording_state"),
  isRecording: z.boolean(),
});
