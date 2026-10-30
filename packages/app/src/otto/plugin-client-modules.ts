import * as openai from "@getpaseo/plugin/otto/openai-settings";
import * as kanban from "@getpaseo/plugin/otto/kanban";
import * as atlassian from "@getpaseo/plugin/otto/atlassian-settings";
import * as bitbucket from "@getpaseo/plugin/otto/bitbucket-connections";
import * as bitbucketUi from "./bitbucket/bridge";
import * as connectors from "@getpaseo/plugin/otto/connectors";
import * as connectorUi from "./connectors/bridge";
import * as knowledge from "@getpaseo/plugin/otto/project-knowledge";
import * as context from "@getpaseo/plugin/otto/context-management";
import * as knowledgeUi from "./knowledge/bridge";
import * as preview from "@getpaseo/plugin/otto/preview";
import * as hostBrowser from "@getpaseo/plugin/otto/host-browser";
import * as previewUi from "./preview/bridge";
import * as artifacts from "@getpaseo/plugin/otto/artifacts";
import * as artifactUi from "./artifacts/bridge";

const shared = new Map<string, unknown>([
  ["@getpaseo/plugin/otto/connectors", connectors],
  ["@getpaseo/plugin/otto/artifacts", artifacts],
  ["@getpaseo/plugin/otto/preview", preview],
  ["@getpaseo/plugin/otto/host-browser", hostBrowser],
  ["@getpaseo/plugin/otto/openai-settings", openai],
  ["@getpaseo/plugin/otto/kanban", kanban],
  ["@getpaseo/plugin/otto/atlassian-settings", atlassian],
  ["@getpaseo/plugin/otto/bitbucket-connections", bitbucket],
  ["@getpaseo/plugin/otto/project-knowledge", knowledge],
  ["@getpaseo/plugin/otto/context-management", context],
]);
const knowledgeModules = new Map<string, unknown>([
  ["@getpaseo/plugin/client/otto-knowledge", knowledgeUi],
]);
/** Public structural contracts are shared; private UI bridges are built-in-only. */
export function ottoClientModule(pluginId: string, name: string): unknown {
  if (pluginId === "otto-integrations" && name === "@getpaseo/plugin/client/otto-connectors")
    return connectorUi;
  if (pluginId === "otto-integrations" && name === "@getpaseo/plugin/client/otto-bitbucket")
    return bitbucketUi;
  if (pluginId === "otto-artifacts" && name === "@getpaseo/plugin/client/otto-artifacts")
    return artifactUi;
  if (pluginId === "otto-browser" && name === "@getpaseo/plugin/client/otto-preview")
    return previewUi;
  if (pluginId === "otto-project-knowledge" && knowledgeModules.has(name))
    return knowledgeModules.get(name);
  return shared.get(name);
}
