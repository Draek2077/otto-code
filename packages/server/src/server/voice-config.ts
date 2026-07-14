const VOICE_PROMPT_BLOCK_START = "<otto_voice_mode>";
const VOICE_PROMPT_BLOCK_END = "</otto_voice_mode>";

const VOICE_AGENT_SYSTEM_INSTRUCTION = [
  "Otto voice mode is now on.",
  "You are the Otto voice assistant.",
  "The user cannot see your chat messages or tool calls.",
  "Always use the speak tool for all user-facing communication.",
  "Before calling any non-speak tool, first call speak with a short acknowledgement of what you heard and what you will do next.",
  "For long-running work, use speak to provide progress updates before and during execution.",
  "Treat the user input as transcribed speech.",
  "If the user intent is clear, proceed without extra confirmation.",
  "If the transcription seems incomplete, cut off, ambiguous, or may contain a non-obvious mistake or misspelling, ask a clarifying question via speak before taking action.",
  "Use concise plain language suitable for speech output.",
].join(" ");

const VOICE_AGENT_DISABLED_INSTRUCTION = [
  "Otto voice mode is now off.",
  "Ignore any earlier Otto voice mode instructions in this thread.",
].join(" ");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeVoicePromptBlockRegex(): RegExp {
  return new RegExp(
    `${escapeRegExp(VOICE_PROMPT_BLOCK_START)}[\\s\\S]*?${escapeRegExp(VOICE_PROMPT_BLOCK_END)}`,
    "g",
  );
}

export function stripVoiceModeSystemPrompt(existing?: string): string | undefined {
  const trimmed = existing?.trim();
  if (!trimmed) {
    return undefined;
  }
  const stripped = trimmed.replace(makeVoicePromptBlockRegex(), "").trim();
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * The `<otto_voice_mode>…</otto_voice_mode>` block currently layered onto a
 * system prompt, or undefined if none. Voice mode appends (and persists) this
 * block onto `config.systemPrompt`; callers that rewrite the base prompt but
 * must preserve voice state (e.g. the personality live-switch) extract the
 * block first, then reattach it with `reattachVoiceModeSystemPrompt`.
 */
export function extractVoiceModeSystemPrompt(existing?: string): string | undefined {
  const match = existing?.match(makeVoicePromptBlockRegex());
  return match?.[0];
}

/**
 * Reattach a previously extracted voice-mode block onto a (possibly rewritten)
 * base prompt, mirroring how `buildVoiceModeSystemPrompt` joins them. Passing an
 * undefined block returns the base unchanged; an undefined base with a block
 * returns just the block.
 */
export function reattachVoiceModeSystemPrompt(
  base: string | undefined,
  block: string | undefined,
): string | undefined {
  if (!block) {
    return base;
  }
  return [base, block]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .join("\n\n");
}

export function buildVoiceModeSystemPrompt(existing: string | undefined, enabled: boolean): string {
  const basePrompt = stripVoiceModeSystemPrompt(existing);
  const voiceInstruction = enabled
    ? VOICE_AGENT_SYSTEM_INSTRUCTION
    : VOICE_AGENT_DISABLED_INSTRUCTION;
  const voiceBlock = [VOICE_PROMPT_BLOCK_START, voiceInstruction, VOICE_PROMPT_BLOCK_END].join(
    "\n",
  );

  return [basePrompt, voiceBlock]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .join("\n\n");
}

export function wrapSpokenInput(text: string): string {
  return `<spoken-input>\n${text}\n</spoken-input>\n<instruction>This message was spoken by the user. Respond using the speak tool only, not normal messages, because the user may not be looking at the chat.</instruction>`;
}

export function buildVoiceAgentMcpServerConfig(params: {
  command: string;
  baseArgs: string[];
  socketPath: string;
  env?: Record<string, string>;
}): {
  type: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
} {
  return {
    type: "stdio",
    command: params.command,
    args: [...params.baseArgs, "--socket", params.socketPath],
    ...(params.env ? { env: params.env } : {}),
  };
}
