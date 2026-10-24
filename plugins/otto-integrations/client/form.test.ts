import { expect, it } from "vitest";
import type { AtlassianAccountSnapshot } from "@getpaseo/plugin/otto/atlassian-settings";
import { openAtlassianForm } from "./form.js";

function snapshot(revision = "first"): AtlassianAccountSnapshot {
  return {
    revision,
    config: {
      email: "person@example.test",
      siteUrl: "https://fixture.atlassian.net",
      route: { kind: "site" },
    },
    credential: { stored: true, source: "stored" },
  };
}
function fixture() {
  const calls: Parameters<Parameters<typeof openAtlassianForm>[2]>[0][] = [];
  const port = {
    write: async (
      _value: (typeof calls)[number],
    ): ReturnType<Parameters<typeof openAtlassianForm>[2]> => ({
      ok: true,
      value: snapshot("second"),
    }),
  };
  const form = openAtlassianForm("selected-host", snapshot(), async (input) => {
    calls.push(input);
    return port.write(input);
  });
  return { form, calls, port };
}
it("submits the captured revision and host and clears an acknowledged secret", async () => {
  const f = fixture();
  f.form.edit({ intent: "replace", replacement: "new-secret" });
  await f.form.save();
  expect(f.calls[0]).toMatchObject({
    hostId: "selected-host",
    expectedRevision: "first",
    credential: { kind: "replace", value: "new-secret" },
  });
  expect(f.form.getSnapshot()).toMatchObject({
    origin: { revision: "second" },
    draft: { intent: "keep", replacement: "" },
    saved: true,
    dirty: false,
  });
});
it("prevents duplicate in-flight saves while retaining newer nonsecret edits", async () => {
  const f = fixture();
  let release: ((value: Awaited<ReturnType<typeof f.port.write>>) => void) | undefined;
  f.port.write = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  f.form.edit({ intent: "replace", replacement: "submitted" });
  const pending = f.form.save();
  f.form.edit({ siteUrl: "new-site" });
  await f.form.save();
  expect(f.calls).toHaveLength(1);
  release!({ ok: true, value: snapshot("acknowledged") });
  await pending;
  expect(f.form.getSnapshot()).toMatchObject({
    origin: { revision: "acknowledged" },
    draft: { siteUrl: "new-site", replacement: "", intent: "keep" },
    dirty: true,
  });
});
it("preserves a newer secret replacement during normalization", async () => {
  const f = fixture();
  let release: ((value: Awaited<ReturnType<typeof f.port.write>>) => void) | undefined;
  f.port.write = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  f.form.edit({ intent: "replace", replacement: "submitted" });
  const pending = f.form.save();
  f.form.edit({ replacement: "newer" });
  release!({ ok: true, value: snapshot("second") });
  await pending;
  expect(f.form.getSnapshot()).toMatchObject({
    draft: { replacement: "newer", intent: "replace" },
    dirty: true,
  });
});
it("lets a known validation rejection be corrected explicitly against the same revision", async () => {
  const f = fixture();
  f.port.write = async () => ({
    ok: false,
    error: { kind: "validation", message: "Correct the site" },
  });
  f.form.edit({ siteUrl: "wrong" });
  await f.form.save();
  expect(f.form.getSnapshot()).toMatchObject({
    blocked: false,
    origin: { revision: "first" },
    draft: { siteUrl: "wrong" },
  });
  f.form.edit({ siteUrl: "correct" });
  await f.form.save();
  expect(f.calls.map((call) => call.expectedRevision)).toEqual(["first", "first"]);
});
it.each(["conflict", "unavailable"] as const)(
  "blocks a %s outcome until confirmed reload",
  async (kind) => {
    const f = fixture();
    f.port.write = async () => ({ ok: false, error: { kind, message: "Reload" } });
    f.form.edit({ siteUrl: "draft" });
    await f.form.save();
    await f.form.save();
    expect(f.calls).toHaveLength(1);
    expect(f.form.getSnapshot()).toMatchObject({
      blocked: true,
      dirty: true,
      draft: { siteUrl: "draft" },
    });
    await f.form.reload(async () => ({ ok: true, value: snapshot("fresh") }));
    expect(f.form.getSnapshot()).toMatchObject({
      blocked: false,
      origin: { revision: "fresh" },
      dirty: false,
    });
  },
);
it("retains failed reload drafts and never converts a blank key into removal", async () => {
  const f = fixture();
  f.form.edit({ intent: "replace", replacement: " " });
  await f.form.save();
  expect(f.calls).toEqual([]);
  await f.form.reload(async () => {
    throw new Error("private response");
  });
  expect(f.form.getSnapshot().draft).toMatchObject({ intent: "replace", replacement: " " });
  expect(f.form.getSnapshot().error).not.toContain("private response");
});
it("clears ephemeral secrets and ignores late acknowledgments after close", async () => {
  const f = fixture();
  let release: ((value: Awaited<ReturnType<typeof f.port.write>>) => void) | undefined;
  f.port.write = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  f.form.edit({ intent: "replace", replacement: "ephemeral" });
  const pending = f.form.save();
  f.form.close();
  release!({ ok: true, value: snapshot("late") });
  await pending;
  expect(f.form.getSnapshot().draft.replacement).toBe("");
  expect(f.form.getSnapshot().origin.revision).toBe("first");
});
