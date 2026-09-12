import type { DaemonClient } from "@otto-code/client";
import { openExternalUrl } from "@/utils/open-external-url";

export const GOOGLE_CONNECTOR_INTEGRATION_ID = "google-connectors";

/** The app receives only safe metadata and the provider's consent URL. */
export async function signInGoogleConnector(
  client: DaemonClient,
  connectorId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const result = await client.integrationsAuthorizationStartBrowser({
    integrationId: GOOGLE_CONNECTOR_INTEGRATION_ID,
    connectionId: connectorId,
  });
  signal.throwIfAborted();
  if (!result.authorizationUrl) throw new Error("Could not start Google sign-in.");
  await openExternalUrl(result.authorizationUrl);
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const overview = await client.integrationsAuthorizationGetOverview();
    signal.throwIfAborted();
    const connection = overview.connections.find(
      (entry) =>
        entry.integrationId === GOOGLE_CONNECTOR_INTEGRATION_ID &&
        entry.connectionId === connectorId,
    );
    if (connection?.state === "connected") return;
    if (connection?.state === "error" || connection?.state === "reauth_required")
      throw new Error(
        "Google sign-in did not complete. Try Connect again and approve the requested permissions.",
      );
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(done, 1000);
      const abort = () => {
        clearTimeout(timer);
        reject(new Error("Google sign-in was cancelled."));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw new Error("Sign-in timed out. Try Connect again.");
}
