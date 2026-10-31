import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PersistedConfig } from "../../persisted-config.js";
import { LocalTtsModelIdSchema } from "../../speech/providers/local/sherpa/model-catalog.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

const Selection = z.object({
  model: LocalTtsModelIdSchema,
  speakerId: z.number().int().nonnegative().optional(),
});

/** COMPAT(ottoSpeechSelections): added v0.10.0; review after 2027-04-30 when
 * supported homes have completed the 0.9 transition. Read-only overlay for
 * selections preserved before these models were supported by the clean base.
 * An explicit current model/provider always wins; never write into either file.
 */
export function restoreSpeechSelection(
  persisted: PersistedConfig,
  legacy: unknown,
): PersistedConfig {
  const current = persisted.features?.voiceMode?.tts;
  if (
    current?.model !== undefined ||
    (current?.provider !== undefined && current.provider !== "local")
  )
    return persisted;
  const features = object(object(legacy).features);
  const dormant = object(object(features.voiceMode).tts);
  const selection = Selection.safeParse(dormant);
  if (!selection.success) return persisted;
  const speed = z.number().min(0.25).max(4).safeParse(dormant.speed);
  return {
    ...persisted,
    features: {
      ...persisted.features,
      voiceMode: {
        ...persisted.features?.voiceMode,
        tts: {
          ...current,
          model: selection.data.model,
          ...(current?.speed === undefined && speed.success ? { speed: speed.data } : {}),
          ...(current?.speakerId === undefined && selection.data.speakerId !== undefined
            ? { speakerId: selection.data.speakerId }
            : {}),
        },
      },
    },
  };
}

export function readPreservedSpeechSelection(home: string): unknown {
  try {
    return JSON.parse(readFileSync(path.join(home, "otto-config.json"), "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return null;
    throw new Error(
      "Preserved Otto speech settings could not be read. The saved file was left unchanged.",
      { cause: error },
    );
  }
}
