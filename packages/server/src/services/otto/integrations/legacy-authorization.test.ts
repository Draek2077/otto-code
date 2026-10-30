import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { legacyIntegrationAccount } from "./legacy-authorization.js";

describe("preserved integration account metadata", () => {
  it("reads only the exact integration/connection label without modifying the legacy registry", async () => {
    const scratch = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
    await mkdir(scratch, { recursive: true });
    const home = await mkdtemp(path.join(scratch, "connector-legacy-accounts-"));
    const file = path.join(home, "integration-authorizations.json");
    const bytes = JSON.stringify([
      {
        integrationId: "google-connectors",
        connectionId: "existing-id",
        accountLabel: "google@example.test",
        unknown: { keep: true },
      },
      {
        integrationId: "connector-hosted-oauth",
        connectionId: "existing-id",
        accountLabel: "box@example.test",
      },
      null,
    ]);
    await writeFile(file, bytes);
    expect(await legacyIntegrationAccount(home, "google-connectors", "existing-id")).toBe(
      "google@example.test",
    );
    expect(await legacyIntegrationAccount(home, "connector-hosted-oauth", "existing-id")).toBe(
      "box@example.test",
    );
    expect(await legacyIntegrationAccount(home, "google-connectors", "other-id")).toBeNull();
    expect(await readFile(file, "utf8")).toBe(bytes);
    await writeFile(file, "corrupt-preserved-content");
    expect(await legacyIntegrationAccount(home, "google-connectors", "existing-id")).toBeNull();
    expect(await readFile(file, "utf8")).toBe("corrupt-preserved-content");
  });
});
