import type { ComposerAttachment } from "@/attachments/types";
import type { MessagePayload } from "@/composer/types";

export interface DictationTranscriptContext {
  value: string;
  defaultSendBehavior: "interrupt" | "steer" | "queue";
  isAgentRunning: boolean;
  isCompacting?: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onSubmit: (payload: MessagePayload) => unknown;
  onChangeText: (text: string) => void;
  attachments: ComposerAttachment[];
  cwd: string;
  autoSend: boolean;
}

export function applyDictationTranscript(text: string, ctx: DictationTranscriptContext): void {
  if (!text) return;
  const shouldPad = ctx.value.length > 0 && !/\s$/.test(ctx.value);
  const nextValue = `${ctx.value}${shouldPad ? " " : ""}${text}`;

  if (!ctx.autoSend) {
    ctx.onChangeText(nextValue);
    return;
  }

  if (
    (ctx.isCompacting || ctx.defaultSendBehavior === "queue") &&
    ctx.isAgentRunning &&
    ctx.onQueue
  ) {
    console.info("[MessageInput] wake-word dictation delivery: queue");
    ctx.onQueue({ text: nextValue, attachments: ctx.attachments, cwd: ctx.cwd });
    ctx.onChangeText("");
    return;
  }

  console.info("[MessageInput] wake-word dictation delivery: send", {
    agentRunning: ctx.isAgentRunning,
  });
  ctx.onSubmit({
    text: nextValue,
    attachments: ctx.attachments,
    cwd: ctx.cwd,
    forceSend: ctx.isAgentRunning && !ctx.isCompacting ? true : undefined,
  });
}
