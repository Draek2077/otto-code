import { createRequire } from "node:module";
import * as pluginSharedRuntime from "@getpaseo/plugin";
import * as pluginProviderRuntime from "@getpaseo/plugin/server/provider";
import * as pluginAcpRuntime from "@getpaseo/plugin/server/acp";
import * as pluginUsageRuntime from "@getpaseo/plugin/server/usage";
import * as pluginServerRuntime from "@getpaseo/plugin/server";
// OTTO(provider-harness): explicit packaged SDK module shared by Otto providers.
import * as ottoOpenAiRuntime from "@getpaseo/plugin/server/otto-openai";
import * as ottoBrainRuntime from "@getpaseo/plugin/server/otto-brain";
import * as ottoKanbanRuntime from "@getpaseo/plugin/server/otto-kanban"; // OTTO(kanban)
import * as ottoKanbanShared from "@getpaseo/plugin/otto/kanban"; // OTTO(kanban)
import * as ottoOpenAiSettings from "@getpaseo/plugin/otto/openai-settings";
import * as ottoAtlassianSettings from "@getpaseo/plugin/otto/atlassian-settings"; // OTTO(integration)
import type { PluginServerContribution } from "@getpaseo/plugin/server";
import * as zod from "zod";
import { isPluginClientOnlySdkSpecifier } from "./plugin-sdk-specifiers.js";

const nodeRequire = createRequire(import.meta.url);

function runtimeRequire(name: string): unknown {
  if (isPluginClientOnlySdkSpecifier(name)) {
    throw new Error(`${name} is available only in plugin client code`);
  }
  if (name === "@getpaseo/plugin") return pluginSharedRuntime;
  // OTTO(provider-harness): keep the full harness on the node-only SDK boundary.
  if (name === "@getpaseo/plugin/server/otto-openai") return ottoOpenAiRuntime;
  if (name === "@getpaseo/plugin/server/otto-brain") return ottoBrainRuntime;
  if (name === "@getpaseo/plugin/server/otto-kanban") return ottoKanbanRuntime; // OTTO(kanban)
  if (name === "@getpaseo/plugin/otto/kanban") return ottoKanbanShared; // OTTO(kanban)
  if (name === "@getpaseo/plugin/otto/openai-settings") return ottoOpenAiSettings;
  if (name === "@getpaseo/plugin/otto/atlassian-settings") return ottoAtlassianSettings; // OTTO(integration)
  if (name === "@getpaseo/plugin/server") return pluginServerRuntime;
  if (name === "@getpaseo/plugin/server/provider") return pluginProviderRuntime;
  if (name === "@getpaseo/plugin/server/acp") return pluginAcpRuntime;
  if (name === "@getpaseo/plugin/server/usage") return pluginUsageRuntime;
  if (name === "zod") return zod;
  if (name === "@getpaseo/plugin/client/host")
    throw new Error(`${name} is private to the app host`);
  return nodeRequire(name);
}

export function evaluateBundle(bundle: string): PluginServerContribution {
  const evaluate: (source: string) => unknown = globalThis.eval;
  const factory = evaluate(bundle);
  if (typeof factory !== "function") throw new Error("Plugin server bundle is not executable");
  const exports = factory(runtimeRequire);
  const setup =
    exports !== null && typeof exports === "object" ? Reflect.get(exports, "default") : undefined;
  if (typeof setup !== "function") {
    throw new Error("Plugin server bundle must default export a function");
  }
  return setup as PluginServerContribution;
}
