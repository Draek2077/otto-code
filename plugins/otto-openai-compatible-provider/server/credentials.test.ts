import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { HostCredentials } from "./credentials.js";

it("stores keys on the host, exposes only status, binds keys to endpoints and rejects stale writes", async () => {
  const root = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  await mkdir(root, { recursive: true });
  const home = await mkdtemp(path.join(root, "provider-credentials-"));
  try {
    const credentials = new HostCredentials(home);
    const initial = await credentials.status("primary", "https://one.invalid/v1");
    expect(initial).toMatchObject({ configured: false, endpointChanged: false });
    const secret = "synthetic-test-key-do-not-use";
    const saved = await credentials.save({
      profileId: "primary",
      baseUrl: "https://one.invalid/v1",
      revision: initial.revision,
      key: secret,
    });
    expect(saved).toMatchObject({ configured: true, endpointChanged: false });
    expect(JSON.stringify(saved).includes(secret)).toBe(false);
    expect(await new HostCredentials(home).key("primary", "https://one.invalid/v1")).toBe(secret);
    await expect(credentials.key("primary", "https://two.invalid/v1")).rejects.toThrow(
      "endpoint changed",
    );
    await expect(
      credentials.save({
        profileId: "primary",
        baseUrl: "https://one.invalid/v1",
        revision: initial.revision,
        key: "stale",
      }),
    ).rejects.toThrow("changed");
    expect(await credentials.key("primary", "https://one.invalid/v1")).toBe(secret);
    const concurrent = await Promise.allSettled([
      credentials.save({
        profileId: "primary",
        baseUrl: "https://one.invalid/v1",
        revision: saved.revision,
        key: "new-key",
      }),
      credentials.save({
        profileId: "second",
        baseUrl: "https://two.invalid/v1",
        revision: saved.revision,
        key: "stale-key",
      }),
    ]);
    expect(concurrent.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    const changed = await credentials.status("primary", "https://two.invalid/v1");
    expect(changed).toMatchObject({ configured: false, endpointChanged: true });
    await credentials.save({
      profileId: "primary",
      baseUrl: "https://two.invalid/v1",
      revision: changed.revision,
      key: null,
    });
    expect(await credentials.key("primary", "https://two.invalid/v1")).toBeUndefined();
    const file = path.join(home, "credentials.json");
    await writeFile(file, "broken fixture");
    await expect(credentials.status("primary", "https://two.invalid/v1")).rejects.toThrow(
      "left intact",
    );
    expect(await readFile(file, "utf8")).toBe("broken fixture");
    await writeFile(file, "");
    await expect(credentials.status("primary", "https://two.invalid/v1")).rejects.toThrow(
      "left intact",
    );
    expect(await readFile(file, "utf8")).toBe("");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
