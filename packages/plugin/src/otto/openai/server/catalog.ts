import { z } from "zod";
import type { ProviderModel, ProviderThinkingOption } from "../../../server/provider.js";
import type { ConnectionSettings } from "../shared/settings.js";
import { authorization, endpoint, readBody, requireOk } from "./http.js";

const standardEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const rawModel = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  context_length: z.number().positive().nullable().optional(),
  architecture: z
    .object({ input_modalities: z.array(z.string()).optional() })
    .nullable()
    .optional(),
  supported_parameters: z.array(z.string()).nullable().optional(),
  reasoning_efforts: z.array(z.string()).nullable().optional(),
  reasoning: z
    .object({
      supported_efforts: z.array(z.string()).nullable().optional(),
      mandatory: z.boolean().optional(),
      default_effort: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export function parseModels(raw: unknown): ProviderModel[] {
  return z
    .object({ data: z.array(rawModel) })
    .parse(raw)
    .data.map((model) => {
      const advertised = model.reasoning?.supported_efforts ?? model.reasoning_efforts;
      const knownUnsupported =
        model.supported_parameters &&
        !model.supported_parameters.some(
          (value) => value === "reasoning" || value === "reasoning_effort",
        );
      let efforts = advertised ?? (knownUnsupported ? [] : standardEfforts);
      if (model.reasoning && model.reasoning.supported_efforts === undefined) efforts = [];
      if (model.reasoning?.mandatory)
        efforts = efforts.filter((value) => value !== "none" && value !== "off");
      const thinkingOptions: ProviderThinkingOption[] = efforts.length
        ? [
            { id: "default", label: "Endpoint default" },
            ...efforts.map((id) => ({
              id,
              label:
                id === "none" || id === "off" ? "Off" : id.charAt(0).toUpperCase() + id.slice(1),
            })),
          ]
        : [];
      const metadata: Record<string, string | string[]> = {
        outputTokenParameter: model.supported_parameters?.includes("max_completion_tokens")
          ? "max_completion_tokens"
          : "max_tokens",
      };
      if (model.architecture?.input_modalities)
        metadata.inputModalities = model.architecture.input_modalities;
      const value: ProviderModel = {
        id: model.id,
        label: model.name ?? model.id,
        thinkingOptions,
        metadata,
      };
      if (thinkingOptions.length) value.defaultThinkingOptionId = "default";
      if (model.context_length) value.contextWindowMaxTokens = model.context_length;
      return value;
    });
}

export async function discoverModels(
  settings: ConnectionSettings,
  signal: AbortSignal,
  apiKey = process.env[settings.apiKeyEnv],
  transport: typeof fetch = fetch,
): Promise<ProviderModel[]> {
  if (!settings.baseUrl) throw new Error("Configure an OpenAI-compatible endpoint first.");
  if (settings.model) return parseModels({ data: [{ id: settings.model }] });
  const response = await transport(endpoint(settings.baseUrl, "models"), {
    headers: authorization(apiKey),
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(settings.timeoutMs, 15000))]),
  });
  await requireOk(response, "Model discovery", apiKey);
  const models = parseModels(JSON.parse(await readBody(response)));
  if (!models.length)
    throw new Error(
      "The endpoint has no available models. Load a model on that host or configure its model ID.",
    );
  return models;
}
