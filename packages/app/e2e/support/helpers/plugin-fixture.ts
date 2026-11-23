import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
// OTTO(paseo-version): plugin manifests describe the API, not Otto's release number.
import { OTTO_PASEO_BASE_VERSION } from "@getpaseo/protocol/otto/identity";

export const pluginRequirements = { paseo: `>=${OTTO_PASEO_BASE_VERSION}` };

export async function copyPluginExample(name: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-plugin-example-"));
  try {
    await cp(path.resolve(__dirname, "../../../../../plugin-examples", name), directory, {
      recursive: true,
    });
    const manifestPath = path.join(directory, "paseo-plugin.json");
    const manifest = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(await readFile(manifestPath, "utf8")));
    // Exercise example UI against the checkout runtime before its release version is bumped.
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
