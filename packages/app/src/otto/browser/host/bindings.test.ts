import { expect, test, vi } from "vitest";
import { HostBrowserBindings } from "./bindings";
const binding = { version: 1 as const, hostId: "host", workspaceId: "workspace" };
function fixture(raw: string | null = null) {
  const storage = {
    getItem: vi.fn(async () => raw),
    setItem: vi.fn(async (_key: string, _value: string) => {}),
  };
  return { storage, bindings: new HostBrowserBindings(storage) };
}
test("absent sidecars are native tabs only after storage has actually resolved", async () => {
  const f = fixture(),
    resource = f.bindings.resource("native");
  expect(resource.getSnapshot()).toEqual({ phase: "loading" });
  await Promise.resolve();
  expect(resource.getSnapshot()).toEqual({ phase: "ready", value: null });
  expect(f.storage.setItem).not.toHaveBeenCalled();
});
test("binding publishes host ownership only after persistence succeeds", async () => {
  const f = fixture();
  let complete!: () => void;
  f.storage.setItem.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const pending = f.bindings.bind("browser", binding),
    resource = f.bindings.resource("browser");
  await Promise.resolve();
  await Promise.resolve();
  expect(resource.getSnapshot()).toEqual({ phase: "ready", value: null });
  complete();
  await pending;
  expect(resource.getSnapshot()).toEqual({ phase: "ready", value: binding });
});
test.each(["{", JSON.stringify({ ...binding, version: 2 }), "x".repeat(8193)])(
  "corrupt or newer sidecars are preserved and block native fallback",
  async (raw) => {
    const f = fixture(raw),
      resource = f.bindings.resource("browser");
    await Promise.resolve();
    expect(resource.getSnapshot().phase).toBe("error");
    await expect(f.bindings.bind("browser", binding)).rejects.toThrow("unavailable");
    expect(f.storage.setItem).not.toHaveBeenCalled();
  },
);
test("unknown saved fields survive repeated adoption, and foreign ownership cannot replace them", async () => {
  const raw = JSON.stringify({ ...binding, future: { kept: true } }),
    f = fixture(raw);
  await f.bindings.bind("browser", binding);
  await expect(f.bindings.bind("browser", { ...binding, hostId: "foreign" })).rejects.toThrow(
    "another host",
  );
  expect(f.storage.setItem).not.toHaveBeenCalled();
});
test("simultaneous adoption serializes against the first owner", async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.bindings.bind("browser", binding),
    f.bindings.bind("browser", { ...binding, workspaceId: "foreign" }),
  ]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(f.storage.setItem).toHaveBeenCalledOnce();
});
test("failed persistence does not publish a host tab and allows a new explicit adoption", async () => {
  const f = fixture();
  f.storage.setItem.mockRejectedValueOnce(new Error("denied"));
  await expect(f.bindings.bind("browser", binding)).rejects.toThrow("denied");
  await f.bindings.bind("browser", binding);
  expect(f.bindings.resource("browser").getSnapshot()).toEqual({ phase: "ready", value: binding });
});
test("read awaits a pending ownership write before selecting a native or hosted pane", async () => {
  const f = fixture();
  let complete!: () => void;
  f.storage.setItem.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const writing = f.bindings.bind("browser", binding);
  await Promise.resolve();
  await Promise.resolve();
  let settled = false;
  const reading = f.bindings.read("browser").then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  complete();
  await writing;
  await expect(reading).resolves.toEqual(binding);
});
test("read refuses corrupt ownership without treating it as a native tab", async () => {
  const f = fixture("{corrupt");
  await expect(f.bindings.read("browser")).rejects.toThrow("unavailable");
  expect(f.storage.setItem).not.toHaveBeenCalled();
});
