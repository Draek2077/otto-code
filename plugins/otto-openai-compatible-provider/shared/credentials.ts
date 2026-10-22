import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { apiBaseUrl } from "./settings.js";

const target = z.object({
  profileId: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
  baseUrl: apiBaseUrl,
  settingsRevision: z.string(),
});
const status = z.object({
  revision: z.string(),
  configured: z.boolean(),
  endpointChanged: z.boolean(),
  source: z.enum(["managed", "environment", "legacy", "none"]),
});
export const credentialStatus = defineRpc({
  name: "credentials.status",
  input: target,
  output: status,
});
export const credentialSave = defineRpc({
  name: "credentials.save",
  input: target.extend({
    revision: z.string(),
    key: z.string().trim().min(1).max(16384).nullable(),
  }),
  output: status,
});
