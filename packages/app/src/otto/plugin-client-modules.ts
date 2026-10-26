import * as openai from "@getpaseo/plugin/otto/openai-settings";
import * as kanban from "@getpaseo/plugin/otto/kanban";
import * as atlassian from "@getpaseo/plugin/otto/atlassian-settings";
import * as knowledge from "@getpaseo/plugin/otto/project-knowledge";
import * as context from "@getpaseo/plugin/otto/context-management";
import * as knowledgeUi from "./knowledge/bridge";

const shared = new Map<string, unknown>([
  ["@getpaseo/plugin/otto/openai-settings", openai],
  ["@getpaseo/plugin/otto/kanban", kanban],
  ["@getpaseo/plugin/otto/atlassian-settings", atlassian],
  ["@getpaseo/plugin/otto/project-knowledge", knowledge],
  ["@getpaseo/plugin/otto/context-management", context],
]);
const knowledgeModules = new Map<string, unknown>([
  ["@getpaseo/plugin/client/otto-knowledge", knowledgeUi],
]);
/** Public structural contracts are shared; private UI bridges are built-in-only. */
export function ottoClientModule(pluginId: string, name: string): unknown {
  if (pluginId === "otto-project-knowledge" && knowledgeModules.has(name))
    return knowledgeModules.get(name);
  return shared.get(name);
}
