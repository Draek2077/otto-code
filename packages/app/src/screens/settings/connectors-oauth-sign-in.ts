import type { DaemonClient } from "@otto-code/client";
import { openExternalUrl } from "@/utils/open-external-url";

export const CONNECTOR_CONSENT_MESSAGE =
  'Waiting for access approval in your browser. After signing in or creating an account, approve access and wait for the "Connected" page. If you only reached your workspace, reopen the sign-in page.';

/** Keep the status listener alive only for this browser sign-in attempt. */
export async function signInOauthConnector(
  client: DaemonClient,
  connectorId: string,
  options: {
    signal: AbortSignal;
    scope?: string;
    onWaiting?(authorizationUrl: string): void;
  },
): Promise<void> {
  const { signal } = options;
  signal.throwIfAborted();
  // A replacement request first ends the previous attempt. Subscribe after its
  // response so that previous attempt's failure cannot settle this one.
  const authorization = await client.connectorsOauthAuthorize(connectorId, options.scope);
  signal.throwIfAborted();
  if (authorization.status === "error") throw new Error(authorization.error ?? "Sign-in failed.");
  if (authorization.status === "authorized") return;
  if (!authorization.authorizationUrl) throw new Error("Could not start sign-in.");

  let cleanup = () => {};
  const settled = new Promise<void>((resolve, reject) => {
    const abort = () => reject(new Error("Sign-in was cancelled."));
    const timeout = setTimeout(
      () =>
        reject(new Error("Sign-in timed out. Connect again and approve access in your browser.")),
      310_000,
    );
    // Subscribe before opening: the browser may finish immediately.
    const unsubscribe = client.on("connectors.oauth.status", (message) => {
      if (message.payload.connectorId !== connectorId) return;
      if (message.payload.status === "connected") resolve();
      else reject(new Error(message.payload.error ?? "Sign-in failed."));
    });
    signal.addEventListener("abort", abort, { once: true });
    cleanup = () => {
      unsubscribe();
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    };
  });
  try {
    await Promise.all([
      settled,
      openExternalUrl(authorization.authorizationUrl).then(() => {
        signal.throwIfAborted();
        options.onWaiting?.(authorization.authorizationUrl!);
        return undefined;
      }),
    ]);
  } finally {
    cleanup();
  }
}
