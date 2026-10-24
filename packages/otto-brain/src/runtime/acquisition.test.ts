import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { SpawnOptions } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import {
  installManagedRuntime,
  listManagedRuntimes,
  removeManagedRuntime,
  serverExeName,
  type RuntimeSpec,
} from "./managed.js";

const native = vi.hoisted(() => ({ fail: false, calls: [] as string[][] }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (command: string, args: readonly string[] = [], options: SpawnOptions = {}) => {
      if (!String(command).endsWith(serverExeName())) return actual.spawn(command, args, options);
      native.calls.push([...args]);
      // Exercise a real short-lived child, without installing/executing a native model binary.
      return actual.spawn(
        process.execPath,
        ["-e", `process.exit(${native.fail ? 1 : 0})`],
        options,
      );
    },
  };
});

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  native.fail = false;
  native.calls = [];
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A synthetic ustar payload; real OS extractors inspect and extract these bytes. */
function archive(name = `build/bin/${serverExeName()}`): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000755\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write("00000000000\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(32, 148, 156);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
}

function fixture() {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-runtime-acquire-"));
  roots.push(root);
  const spec: RuntimeSpec = {
    label: "CPU (managed)",
    version: "b10265",
    variant: "cpu",
    platform: process.platform,
    assets: ["https://fixture.invalid/runtime.tar.gz"],
  };
  return { root, spec };
}

it.skipIf(process.platform !== "win32")(
  "extracts the Windows ZIP path with the system tools",
  async () => {
    const { root, spec } = fixture();
    const name = Buffer.from(`build/bin/${serverExeName()}`);
    // Stored, empty ZIP entry: no native binary or extra archive dependency.
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(local.length + name.length, 16);
    const zip = Buffer.concat([local, name, central, name, end]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(zip)),
    );
    const runtime = await installManagedRuntime(
      { ...spec, assets: ["https://fixture.invalid/runtime.zip"] },
      root,
    );
    expect(fs.existsSync(runtime.exe)).toBe(true);
    expect(native.calls).toEqual([["--version"]]);
  },
  15000,
);

it("downloads, inspects, extracts and probes a staged fixture before publishing inventory", async () => {
  const { root, spec } = fixture();
  const payload = archive();
  const progress: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(payload, { headers: { "content-length": String(payload.length) } }),
    ),
  );
  const runtime = await installManagedRuntime(spec, root, (event) => progress.push(event.phase));
  expect(fs.existsSync(runtime.exe)).toBe(true);
  expect(native.calls).toEqual([["--version"]]);
  expect(progress).toContain("extracting");
  expect(progress.at(-1)).toBe("done");
  expect(listManagedRuntimes(root)[0]).toMatchObject({ exe: runtime.exe, version: "b10265" });
  expect(fs.readdirSync(root)).toEqual(["cpu-managed-b10265"]);
  await expect(installManagedRuntime(spec, root)).rejects.toThrow("already exists");
  expect(fs.existsSync(runtime.exe)).toBe(true);
  expect(() => removeManagedRuntime(root, "../escape")).toThrow("invalid runtime name");
  removeManagedRuntime(root, "cpu-managed-b10265");
  expect(listManagedRuntimes(root)).toEqual([]);
});

it("does not expose a partial runtime when an archive is missing", async () => {
  const { root, spec } = fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("missing", { status: 404 })),
  );
  await expect(installManagedRuntime(spec, root)).rejects.toThrow("404");
  expect(fs.readdirSync(root)).toEqual([]);
});

it("rejects a failed executable probe and preserves an unrelated installed runtime", async () => {
  const { root, spec } = fixture();
  const existing = path.join(root, "older-runtime");
  fs.mkdirSync(existing);
  fs.writeFileSync(path.join(existing, "user-setting"), "preserve me");
  native.fail = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(archive())),
  );
  await expect(installManagedRuntime(spec, root)).rejects.toThrow("runtime verification failed");
  expect(fs.readdirSync(root)).toEqual(["older-runtime"]);
  expect(fs.readFileSync(path.join(existing, "user-setting"), "utf8")).toBe("preserve me");
});

it("rejects an archive traversal before extracting any files", async () => {
  const { root, spec } = fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(archive("../escaped-file"))),
  );
  await expect(installManagedRuntime(spec, root)).rejects.toThrow("unsafe runtime archive path");
  expect(fs.readdirSync(root)).toEqual([]);
});

it("an already-cancelled install does not create a stage or request an asset", async () => {
  const { root, spec } = fixture();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(installManagedRuntime(spec, root, undefined, AbortSignal.abort())).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(fs.readdirSync(root)).toEqual([]);
});
