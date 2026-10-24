/** Settings share the existing authenticated management listener and its write policy. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrainOwnerSettings } from "./owner-settings.js";
import { OwnerSettingsError } from "./owner-settings-contract.js";
import { readObject, sendJson } from "./http-body.js";

const ROUTES = new Set([
  "GET /__host/settings",
  "POST /__host/settings",
  "POST /__host/settings/access-key",
  "POST /__host/settings/discover-network",
]);
export async function handleOwnerSettings(
  settings: BrainOwnerSettings,
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal,
  requireWrite: (request: IncomingMessage) => void,
): Promise<boolean> {
  const route = request.url?.split("?")[0];
  if (!ROUTES.has(`${request.method} ${route}`)) return false;
  if (request.method === "GET") {
    sendJson(response, 200, settings.read());
    return true;
  }
  requireWrite(request);
  const body = await readObject(request, signal, 128 * 1024);
  try {
    if (route === "/__host/settings/discover-network") {
      sendJson(response, 200, await settings.discoverNetwork(body, signal));
      return true;
    }
    const result =
      route === "/__host/settings/access-key"
        ? settings.generateAccessKey(body)
        : settings.save(body);
    sendJson(response, 200, result);
  } catch (error) {
    if (!(error instanceof OwnerSettingsError)) throw error;
    const status = error.kind === "validation" ? 422 : 409;
    sendJson(response, status, { error: { kind: error.kind, message: error.message } });
  }
  return true;
}
