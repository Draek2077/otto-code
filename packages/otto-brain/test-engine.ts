/** Synthetic Node HTTP engine. No native runtime or model data is executed. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createSupervisorFixture } from "./test-runtime.js";
import { engineFixtureSource } from "./test-engine-script.mjs";

export async function createEngineFixture() {
  const fixture = await createSupervisorFixture();
  writeFileSync(path.join(fixture.root, "fixture.mjs"), engineFixtureSource());
  return fixture;
}
