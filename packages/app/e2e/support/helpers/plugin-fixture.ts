import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { PASEO_PLUGIN_API_VERSION } from "@otto-code/protocol/plugin-compatibility";

export const pluginRequirements = { paseo: `>=${PASEO_PLUGIN_API_VERSION}` };

export async function copyPluginExample(name: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "otto-plugin-example-"));
  try {
    await cp(path.resolve(__dirname, "../../../../../plugin-examples", name), directory, {
      recursive: true,
    });
    const candidates = await Promise.all(
      ["otto-plugin.json", "paseo-plugin.json"].map(async (filename) => {
        const candidate = path.join(directory, filename);
        return (await stat(candidate).catch(() => null))?.isFile() ? candidate : null;
      }),
    );
    const manifests = candidates.filter((candidate): candidate is string => candidate !== null);
    if (manifests.length > 1) {
      throw new Error(
        "Plugin directory contains both otto-plugin.json and paseo-plugin.json; keep one manifest",
      );
    }
    const manifestPath = manifests[0];
    if (!manifestPath) {
      throw new Error(`Plugin manifest is missing: ${path.join(directory, "otto-plugin.json")}`);
    }
    const manifest = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(await readFile(manifestPath, "utf8")));
    // Fixtures target the integrated plugin API, independently of the Otto package release.
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, requirements: pluginRequirements }),
    );
    return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
