import { expect, test } from "vitest";
import { BuiltinPluginLoader } from "../../plugins/builtin/index.js";
import { withOttoHostRpcIds } from "../builtin-plugins.js";
import { gitFetchAvailable } from "./capabilities.js";

test("the Git route is reserved without loading a plugin or adding a startup worker", async () => {
  const loader = new BuiltinPluginLoader("fixture", ["provider"]);
  const registered = withOttoHostRpcIds(loader.ids);
  expect([...registered]).toEqual(["provider", "otto-workspace-git"]);
  expect(registered.has("untrusted-plugin")).toBe(false);
  const loaded: string[] = [];
  await loader.load(async ({ id }) => {
    loaded.push(id);
  });
  expect(loaded).toEqual(["provider"]);
  expect([...loader.ids]).toEqual(["provider"]);
});
test("the feature is advertised only when its concrete host bridge is ready", () => {
  expect(gitFetchAvailable(undefined)).toBe(false);
  expect(gitFetchAvailable({ supportsBuiltinRpc: () => false })).toBe(false);
  expect(gitFetchAvailable({ supportsBuiltinRpc: (id) => id === "otto-workspace-git" })).toBe(true);
});
