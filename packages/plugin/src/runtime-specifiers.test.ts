import { expect, it } from "vitest";
import {
  PLUGIN_SDK_SPECIFIERS,
  resolvePluginSdkSpecifier,
  isPluginHostSdkSpecifier,
} from "./runtime-specifiers.js";

it("maps both author namespaces to one canonical entry and identical runtime ownership", () => {
  for (const specifier of PLUGIN_SDK_SPECIFIERS.filter((value) =>
    value.startsWith("@otto-code/"),
  )) {
    const owned = resolvePluginSdkSpecifier(specifier)!;
    const upstream = resolvePluginSdkSpecifier(specifier.replace("@otto-code/", "@getpaseo/"))!;
    expect(upstream).toEqual({ ...owned, namespace: "paseo" });
  }
});

it("keeps host-private and unknown entries out of author runtimes", () => {
  for (const namespace of ["@otto-code/plugin", "@getpaseo/plugin"]) {
    expect(isPluginHostSdkSpecifier(`${namespace}/client/host`)).toBe(true);
    expect(resolvePluginSdkSpecifier(`${namespace}/client/host`)).toBeUndefined();
    expect(resolvePluginSdkSpecifier(`${namespace}/private`)).toBeUndefined();
    expect(resolvePluginSdkSpecifier(`${namespace}/host`)).toBeUndefined();
  }
});
