import { beforeEach, describe, expect, it } from "vitest";
import BaseStorage from "@react-native-async-storage/async-storage";
import OttoStorage, { fromOttoStorageKey, toOttoStorageKey } from "./async-storage";

beforeEach(async () => {
  await BaseStorage.clear();
});

describe("Otto storage keys", () => {
  it("reads existing host pairings and drafts from Otto keys", async () => {
    await BaseStorage.multiSet([
      ["@otto:daemon-registry", "saved-hosts"],
      ["otto-drafts", "unsent-text"],
    ]);
    expect(await OttoStorage.getItem("@paseo:daemon-registry")).toBe("saved-hosts");
    expect(await OttoStorage.multiGet(["@paseo:daemon-registry", "paseo-drafts"])).toEqual([
      ["@paseo:daemon-registry", "saved-hosts"],
      ["paseo-drafts", "unsent-text"],
    ]);
    expect(await OttoStorage.getAllKeys()).toEqual(["@paseo:daemon-registry", "paseo-drafts"]);
  });

  it("writes and removes through Otto keys without creating parallel Paseo state", async () => {
    await OttoStorage.setItem("paseo-drafts", "new-text");
    await OttoStorage.multiSet([["@paseo/provider-snapshot/v2", "snapshot"]]);
    expect(await BaseStorage.getItem("otto-drafts")).toBe("new-text");
    expect(await BaseStorage.getItem("@otto/provider-snapshot/v2")).toBe("snapshot");
    expect(await BaseStorage.getItem("paseo-drafts")).toBeNull();
    await OttoStorage.removeItem("paseo-drafts");
    await OttoStorage.multiRemove(["@paseo/provider-snapshot/v2"]);
    expect(await BaseStorage.getAllKeys()).toEqual([]);
  });

  it("stores Paseo-named keys under the names Otto 0.9 used", () => {
    expect(toOttoStorageKey("@paseo:daemon-registry")).toBe("@otto:daemon-registry");
    expect(toOttoStorageKey("@paseo/provider-snapshot/v2")).toBe("@otto/provider-snapshot/v2");
    expect(toOttoStorageKey("paseo-drafts")).toBe("otto-drafts");
  });

  it("leaves keys without a Paseo name unchanged", () => {
    expect(toOttoStorageKey("panel-state")).toBe("panel-state");
    expect(toOttoStorageKey("@paseoish:other")).toBe("@paseoish:other");
  });

  it("maps stored Otto keys back to the names Paseo code asks for", () => {
    for (const key of ["@paseo:settings", "@paseo/provider-snapshot-index/v1", "paseo-drafts"]) {
      expect(fromOttoStorageKey(toOttoStorageKey(key))).toBe(key);
    }
  });
});
