import { z } from "zod";

// Private presentation transport, independent of Paseo's encrypted wire protocol.
export const VISUALIZER_BRIDGE_VERSION = 1;
export const VISUALIZER_MAX_FRAME = 1_000_000;
export const VISUALIZER_MAX_SESSIONS = 64;
export const VISUALIZER_MAX_EVENTS = 8000;
const id = z.string().min(1).max(512);
const label = z.string().max(200);
export const VisualizerEvent = z.object({
  time: z.number().finite().nonnegative(),
  sessionId: id,
  type: z.enum([
    "agent_spawn",
    "agent_rename",
    "agent_complete",
    "agent_idle",
    "model_detected",
    "tool_call_start",
    "tool_call_end",
    "file_collision",
    "message",
    "context_update",
    "subagent_dispatch",
    "subagent_return",
    "permission_requested",
  ]),
  payload: z.record(z.string(), z.unknown()),
  hydrate: z.boolean().optional(),
});
export type VisualizerEvent = z.infer<typeof VisualizerEvent>;
export const VisualizerSession = z.object({
  id,
  label,
  status: z.enum(["active", "completed"]),
  startTime: z.number().finite(),
  lastActivityTime: z.number().finite(),
});
export type VisualizerSession = z.infer<typeof VisualizerSession>;
export const VisualizerConfig = z.object({
  showMockData: z.boolean().optional(),
  paused: z.boolean().optional(),
  panels: z
    .object({
      timeline: z.boolean(),
      fileAttention: z.boolean(),
      costOverlay: z.boolean(),
      failures: z.boolean(),
      stats: z.boolean(),
    })
    .partial()
    .optional(),
  render: z
    .object({
      bloom: z.boolean(),
      nodeGlow: z.boolean(),
      stars: z.boolean(),
      backdrop: z.boolean(),
      showFps: z.boolean(),
      nodeShape: z.enum(["circle", "hexagon", "octagon", "square"]),
      contextDisplay: z.enum(["ring", "bar"]),
    })
    .partial()
    .optional(),
  camera: z
    .object({
      viewportPadding: z.number().min(0).max(500),
      autoFitMaxScale: z.number().min(0.1).max(5),
    })
    .partial()
    .optional(),
  soundVolume: z.number().min(0).max(1).optional(),
  hudHidden: z.boolean().optional(),
  hudBottomHidden: z.boolean().optional(),
  hudCompact: z.boolean().optional(),
  showLatestAssistantBubble: z.boolean().optional(),
});
export type VisualizerConfig = z.infer<typeof VisualizerConfig>;
export const VisualizerCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("config"), config: VisualizerConfig }),
  z.object({ type: z.literal("reset"), reason: z.string().max(200) }),
  z.object({
    type: z.literal("connection-status"),
    status: z.enum(["connected", "disconnected", "connecting"]),
    source: label,
  }),
  z.object({
    type: z.literal("session-list"),
    sessions: z.array(VisualizerSession).max(VISUALIZER_MAX_SESSIONS),
  }),
  z.object({ type: z.literal("session-started"), session: VisualizerSession, select: z.boolean() }),
  z.object({ type: z.literal("session-ended"), sessionId: id }),
  z.object({ type: z.literal("session-updated"), sessionId: id, label }),
  z.object({ type: z.literal("select-session"), sessionId: id }),
  z.object({ type: z.literal("close-session"), sessionId: id }),
  z.object({
    type: z.literal("viewport-command"),
    action: z.enum(["zoom-to-fit", "restart", "cold-restart"]),
  }),
  z.object({
    type: z.literal("agent-event-batch"),
    events: z.array(VisualizerEvent).max(96),
    hydrate: z.boolean(),
  }),
  z.object({
    type: z.literal("otto-appearance"),
    uiFontFamily: z.string().max(200),
    codeFontFamily: z.string().max(200),
    chatFontSize: z.number().min(8).max(32),
  }),
]);
export type VisualizerCommand = z.infer<typeof VisualizerCommand>;
export const VisualizerGuestMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("sound-muted"), muted: z.boolean() }),
  z.object({
    type: z.literal("panel-toggle"),
    panel: z.enum(["timeline", "files", "cost", "failures", "stats"]),
  }),
  z.object({
    type: z.literal("open-file"),
    filePath: z.string().min(1).max(4096),
    line: z.number().int().positive().max(10_000_000).optional(),
  }),
  z.object({
    type: z.literal("session-state"),
    sessions: z
      .array(VisualizerSession.pick({ id: true, label: true, status: true }))
      .max(VISUALIZER_MAX_SESSIONS),
    selectedId: id.nullable(),
    activityIds: z.array(id).max(VISUALIZER_MAX_SESSIONS),
  }),
]);
export type VisualizerGuestMessage = z.infer<typeof VisualizerGuestMessage>;
export function parseVisualizerFrame(
  input: unknown,
  channel: string,
  guest: true,
): VisualizerGuestMessage | null;
export function parseVisualizerFrame(
  input: unknown,
  channel: string,
  guest?: false,
): VisualizerCommand | null;
export function parseVisualizerFrame(input: unknown, channel: string, guest = false) {
  try {
    const text = typeof input === "string" ? input : JSON.stringify(input);
    if (!text || text.length > VISUALIZER_MAX_FRAME) return null;
    const envelope = z
      .object({ version: z.literal(1), channel: id, message: z.unknown() })
      .safeParse(JSON.parse(text));
    if (!envelope.success || envelope.data.channel !== channel) return null;
    const result = (guest ? VisualizerGuestMessage : VisualizerCommand).safeParse(
      envelope.data.message,
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function visualizerFrame(
  channel: string,
  message: VisualizerCommand | VisualizerGuestMessage,
) {
  return { version: VISUALIZER_BRIDGE_VERSION, channel, message };
}
