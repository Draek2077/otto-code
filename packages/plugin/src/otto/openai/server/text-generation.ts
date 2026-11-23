import type { ProviderModel } from "../../../server/provider.js";
import { SessionConfiguration } from "./session-config.js";
import { streamCompletion } from "./completions.js";
import type { EndpointProfile } from "./endpoints.js";

/** No session, instructions, MCP connector, native tool map, file port or persistence is constructed. */
export async function generateToolFreeText(input: {
  model: string;
  prompt: string;
  profile: EndpointProfile;
  models: readonly ProviderModel[];
  apiKey?: string;
  transport?: typeof fetch;
}): Promise<string> {
  const configuration = new SessionConfiguration(
    { cwd: ".", env: {}, mcpServers: {}, settings: {}, model: input.model, persist: false },
    input.models,
    undefined,
    input.profile.id,
  );
  const abort = new AbortController();
  const result = await streamCompletion({
    ...configuration.requestSettings(input.profile.settings.baseUrl),
    baseUrl: input.profile.settings.baseUrl,
    apiKey: input.apiKey,
    transport: input.transport,
    messages: [{ role: "user", content: input.prompt }],
    tools: [],
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(input.profile.settings.timeoutMs)]),
    onText(text) {
      // streamCompletion publishes the accumulated text, not just the latest delta.
      if (text.length > 262144) {
        abort.abort();
        throw new Error("The proposal exceeded the bounded text limit.");
      }
    },
  });
  if (result.toolCalls.length) throw new Error("Tool calls are not accepted in a prose proposal.");
  return result.content;
}
