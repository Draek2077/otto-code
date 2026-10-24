import { z } from "zod";
import type {
  ProviderConfigChanges,
  ProviderConfigState,
  ProviderMode,
  ProviderModel,
  ProviderSessionConfig,
} from "../../../server/provider.js";
import { parseModels } from "./catalog.js";
import { modelReference } from "./endpoints.js";

export const modes: ProviderMode[] = [
  {
    id: "default",
    label: "Ask before tools",
    description: "Ask before executing tools, except exact host-approved MCP grants.",
  },
  {
    id: "acceptEdits",
    label: "Accept file edits",
    description: "Allow reads and file writes inside this workspace; ask before other actions.",
  },
  {
    id: "plan",
    label: "Read only",
    description: "Offer read tools only. This mode is an application policy, not an OS sandbox.",
  },
  {
    id: "dontAsk",
    label: "Don't ask",
    description:
      "Allow workspace reads and exact host grants; deny actions that would require approval.",
    isUnattended: true,
  },
  {
    id: "bypassPermissions",
    label: "Bypass",
    description: "Run available tools without approval prompts.",
    isUnattended: true,
  },
];
const outputLimits = ["default", "1024", "4096", "8192", "16384", "32768", "65536"] as const;
const autoCompaction = ["off", "50", "60", "70", "80", "90"] as const;
export const preferencesSchema = z.object({
  model: z.string().min(1),
  mode: z.enum(["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"]),
  thinkingOption: z.string(),
  output_limit: z.enum(outputLimits),
  // COMPAT(providerPreferences): added in v0.10.0; remove the old-record default after 2027-04-22.
  auto_compact: z.enum(autoCompaction).default("80"),
});
export type SessionPreferences = z.infer<typeof preferencesSchema>;

export class SessionConfiguration {
  private value: SessionPreferences;
  restore(value: SessionPreferences): void {
    this.value = preferencesSchema.parse(value);
  }
  constructor(
    config: ProviderSessionConfig,
    private readonly models: readonly ProviderModel[],
    saved?: SessionPreferences,
    private readonly profileId = "primary",
  ) {
    this.value = preferencesSchema.parse({
      model: config.model ?? saved?.model,
      mode: config.mode ?? saved?.mode ?? "default",
      thinkingOption: config.thinkingOption ?? saved?.thinkingOption ?? "default",
      output_limit: config.settings.output_limit ?? saved?.output_limit ?? "default",
      auto_compact: config.settings.auto_compact ?? saved?.auto_compact ?? "80",
    });
    this.checkSettings(config.settings);
    this.validate(this.value);
  }

  private checkSettings(settings: ProviderConfigChanges["settings"]): void {
    for (const key of Object.keys(settings ?? {}))
      if (key !== "output_limit" && key !== "auto_compact")
        throw new Error(
          `Unsupported OpenAI-compatible setting: ${key}. Existing values were left intact.`,
        );
  }

  private validate(value: SessionPreferences): void {
    const options = this.model(value.model).thinkingOptions ?? [];
    if (
      value.thinkingOption !== "default" &&
      !options.some((option) => option.id === value.thinkingOption)
    )
      throw new Error(
        `The selected model does not advertise reasoning option ${value.thinkingOption}. Select Endpoint default or an advertised option.`,
      );
  }

  model(id = this.value.model): ProviderModel {
    const reference = modelReference(id);
    if (reference.profileId !== this.profileId)
      throw new Error(
        "Create a new chat to use a different endpoint. This conversation stays on its original host.",
      );
    // A catalog is metadata, not authority to replace an explicitly selected model ID.
    const known = this.models.find((model) => model.id === id);
    if (known?.isSelectable === false)
      throw new Error(known.description ?? "This endpoint is unavailable.");
    return known ?? { ...parseModels({ data: [{ id: reference.modelId }] })[0]!, id };
  }

  snapshot(): SessionPreferences {
    return { ...this.value };
  }

  update(changes: ProviderConfigChanges): void {
    this.checkSettings(changes.settings);
    const next = preferencesSchema.parse({
      model: changes.model === undefined ? this.value.model : (changes.model ?? this.models[0]?.id),
      mode: changes.mode === undefined ? this.value.mode : (changes.mode ?? "default"),
      thinkingOption:
        changes.thinkingOption === undefined
          ? this.value.thinkingOption
          : (changes.thinkingOption ?? "default"),
      output_limit: changes.settings?.output_limit ?? this.value.output_limit,
      auto_compact: changes.settings?.auto_compact ?? this.value.auto_compact,
    });
    this.validate(next);
    this.value = next;
  }

  state(): ProviderConfigState {
    const model = this.model();
    return {
      model: this.value.model,
      mode: this.value.mode,
      thinkingOption: this.value.thinkingOption,
      models: this.models.some((item) => item.id === model.id)
        ? this.models
        : [...this.models, model],
      modes,
      thinkingOptions: model.thinkingOptions ?? [],
      settings: [
        {
          type: "select",
          id: "auto_compact",
          label: "Automatic compaction",
          description:
            "Summarize older context at this estimated share of the model window. Off leaves manual /compact available. Unknown windows use an 8192-token trigger estimate.",
          value: this.value.auto_compact,
          options: autoCompaction.map((value) => ({
            value,
            label: value === "off" ? "Off" : `${value}%`,
          })),
        },
        {
          type: "select",
          id: "output_limit",
          label: "Maximum response tokens",
          description:
            "Endpoint default leaves the response limit unset. For reasoning models, an explicit limit can include reasoning tokens.",
          value: this.value.output_limit,
          options: outputLimits.map((value) => ({
            value,
            label: value === "default" ? "Endpoint default" : `${value} tokens`,
          })),
        },
      ],
    };
  }

  requestSettings(baseUrl: string, value = this.value) {
    const effort = value.thinkingOption;
    const reasoning =
      effort !== "default" && new URL(baseUrl).hostname === "openrouter.ai"
        ? { effort: effort === "off" ? "none" : effort }
        : undefined;
    return {
      model: modelReference(value.model).modelId,
      ...(effort !== "default" && !reasoning ? { reasoningEffort: effort } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(value.output_limit !== "default" ? { maxTokens: Number(value.output_limit) } : {}),
      outputTokenParameter:
        this.model(value.model).metadata?.outputTokenParameter === "max_completion_tokens"
          ? ("max_completion_tokens" as const)
          : ("max_tokens" as const),
    };
  }
}
