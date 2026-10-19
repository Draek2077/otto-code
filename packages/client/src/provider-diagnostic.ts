import type { ProviderDiagnosticResponseMessage } from "@otto-code/protocol/messages";
import {
  ProviderDiscoveryOptionsSchema,
  type ProviderDiscoveryOptions,
} from "@otto-code/protocol/provider-discovery";
export type ProviderDiagnosticPayload = ProviderDiagnosticResponseMessage["payload"];

export interface ProviderDiagnosticOptions {
  requestId?: string;
  discovery?: ProviderDiscoveryOptions;
}
interface DiagnosticRequest {
  requestId?: string;
  message: {
    type: "provider_diagnostic_request";
    provider: string;
    discovery?: ProviderDiscoveryOptions;
  };
  responseType: "provider_diagnostic_response";
  timeout: number;
}
export function requestProviderDiagnostic(
  supportsDiscovery: boolean,
  provider: string,
  options: ProviderDiagnosticOptions | undefined,
  send: (params: DiagnosticRequest) => Promise<ProviderDiagnosticResponseMessage["payload"]>,
): Promise<ProviderDiagnosticResponseMessage["payload"]> {
  if (options?.discovery) {
    // COMPAT(providerDiscoveryDiagnostic): added in post-v0.9.34 development; remove after
    // 2027-04-16 once the daemon floor includes this capability.
    if (!supportsDiscovery)
      throw new Error("Update the host to use provider discovery diagnostics.");
    ProviderDiscoveryOptionsSchema.parse(options.discovery);
  }
  return send({
    requestId: options?.requestId,
    message: {
      type: "provider_diagnostic_request",
      provider,
      ...(options?.discovery ? { discovery: options.discovery } : {}),
    },
    responseType: "provider_diagnostic_response",
    timeout: options?.discovery ? 20_000 : 180_000,
  });
}
