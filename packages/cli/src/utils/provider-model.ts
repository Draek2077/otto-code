import type { CommandError } from "../output/index.js";

export interface ResolveProviderAndModelOptions {
  provider?: string;
  model?: string;
  defaultProvider?: string;
}

export interface ResolvedProviderModel {
  provider: string;
  model: string | undefined;
}

/**
 * The one provider/model check that needs no daemon: `--provider a/b --model c` is contradictory
 * on its face.
 *
 * Callers run this **before** connecting. Full resolution happens after a connection because it
 * consults the host (personalities, defaults), so leaving this check there meant a plainly
 * malformed command line reported "Cannot connect to daemon" instead of the real problem — and
 * only on machines without a daemon running, which is why it read as a CI-only failure.
 *
 * Silent when either input is absent or they agree; `resolveProviderAndModel` still repeats the
 * check for callers that reach it directly.
 */
export function assertNoConflictingModelInputs(provider?: string, model?: string): void {
  const providerInput = provider?.trim();
  const modelInput = model?.trim();
  if (!providerInput || !modelInput) {
    return;
  }
  const slashIndex = providerInput.indexOf("/");
  if (slashIndex === -1) {
    return;
  }
  const modelFromProvider = providerInput.slice(slashIndex + 1).trim();
  if (!modelFromProvider || modelFromProvider === modelInput) {
    return;
  }
  const error: CommandError = {
    code: "CONFLICTING_MODEL_OPTIONS",
    message: "Conflicting model values provided",
    details: `--provider specifies model ${modelFromProvider}, but --model specifies ${modelInput}`,
  };
  throw error;
}

export function resolveProviderAndModel(
  options: ResolveProviderAndModelOptions,
): ResolvedProviderModel {
  const providerInput = options.provider?.trim() || options.defaultProvider;
  const modelInput = options.model?.trim();

  if (!providerInput) {
    const error: CommandError = {
      code: "MISSING_PROVIDER",
      message: "Provider is required",
      details:
        "Pass --provider <provider> or --provider <provider>/<model>. Use `otto provider ls` to see providers and `otto provider models <provider>` to see models.",
    };
    throw error;
  }

  if (options.model !== undefined && !modelInput) {
    const error: CommandError = {
      code: "INVALID_MODEL",
      message: "--model cannot be empty",
    };
    throw error;
  }

  const slashIndex = providerInput.indexOf("/");
  if (slashIndex === -1) {
    return {
      provider: providerInput,
      model: modelInput,
    };
  }

  const provider = providerInput.slice(0, slashIndex).trim();
  const modelFromProvider = providerInput.slice(slashIndex + 1).trim();
  if (!provider || !modelFromProvider) {
    const error: CommandError = {
      code: "INVALID_PROVIDER",
      message: "Invalid --provider value",
      details: "Use --provider <provider> or --provider <provider>/<model>",
    };
    throw error;
  }

  if (modelInput && modelInput !== modelFromProvider) {
    const error: CommandError = {
      code: "CONFLICTING_MODEL_OPTIONS",
      message: "Conflicting model values provided",
      details: `--provider specifies model ${modelFromProvider}, but --model specifies ${modelInput}`,
    };
    throw error;
  }

  return {
    provider,
    model: modelInput ?? modelFromProvider,
  };
}
