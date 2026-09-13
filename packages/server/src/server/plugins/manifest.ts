import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PluginIdSchema, PluginRequirementsSchema } from "@otto-code/protocol/messages";
import { validatePluginRequirements } from "@otto-code/protocol/plugin-requirements";

const MANIFEST_FILENAMES = ["otto-plugin.json", "paseo-plugin.json"] as const;
const PluginBuildCommandSchema = z
  .array(z.string().refine((argument) => argument.trim().length > 0))
  .min(1);
const PluginManifestSchema = z
  .object({
    id: PluginIdSchema,
    requirements: PluginRequirementsSchema.strict().optional(),
    build: z.array(PluginBuildCommandSchema).min(1).optional(),
  })
  .strict();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export async function readPluginManifest(directory: string): Promise<PluginManifest> {
  const candidates = await Promise.all(
    MANIFEST_FILENAMES.map(async (name) => {
      const manifestPath = path.join(directory, name);
      return (await stat(manifestPath).catch(() => null))?.isFile() ? manifestPath : null;
    }),
  );
  const manifests = candidates.filter((candidate): candidate is string => candidate !== null);
  if (manifests.length > 1)
    throw new Error(
      "Plugin directory contains both otto-plugin.json and paseo-plugin.json; keep one manifest",
    );
  const manifestPath = manifests[0];
  if (!manifestPath)
    throw new Error(`Plugin manifest is missing: ${path.join(directory, MANIFEST_FILENAMES[0])}`);
  const manifest = PluginManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  validatePluginRequirements(manifest.requirements);
  return manifest;
}
