import * as openai from "@getpaseo/plugin/otto/openai-settings";
import * as speech from "@getpaseo/plugin/otto/speech"; // OTTO(speech)
import * as speechUi from "./speech/bridge"; // OTTO(speech)
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
import * as views from "@getpaseo/plugin/otto/architectural-views"; // OTTO(architectural-views)
import * as viewUi from "./architectural-views/bridge"; // OTTO(architectural-views): lazy trusted presentation only.
import * as workflows from "@getpaseo/plugin/otto/workflows"; // OTTO(workflows)
import * as schedules from "@getpaseo/plugin/otto/schedules"; // OTTO(schedules)
import * as workflowUi from "./workflows/bridge"; // OTTO(workflows)
import * as scheduleUi from "./schedules/bridge"; // OTTO(schedules): lazy trusted settings bridge, original navigation retained.
import * as visualizerUi from "./visualizer/bridge"; // OTTO(visualizer): lazy presentation, canonical Paseo session owner.

const shared = new Map<string, unknown>([
  ["@getpaseo/plugin/otto/speech", speech],
  ["@getpaseo/plugin/otto/connectors", connectors],
  ["@getpaseo/plugin/otto/artifacts", artifacts],
  ["@getpaseo/plugin/otto/architectural-views", views],
  ["@getpaseo/plugin/otto/workflows", workflows],
  ["@getpaseo/plugin/otto/schedules", schedules], // OTTO(schedules)
  ["@getpaseo/plugin/otto/preview", preview],
  ["@getpaseo/plugin/otto/host-browser", hostBrowser],
  ["@getpaseo/plugin/otto/openai-settings", openai],
  ["@getpaseo/plugin/otto/kanban", kanban],
  ["@getpaseo/plugin/otto/atlassian-settings", atlassian],
  ["@getpaseo/plugin/otto/bitbucket-connections", bitbucket],
  ["@getpaseo/plugin/otto/project-knowledge", knowledge],
  ["@getpaseo/plugin/otto/context-management", context],
]);
// OTTO(visualizer): explicit plugin/module pairs keep trusted UI bridges private
// without extending a branch chain whenever another built-in is restored.
const builtinUi = new Map<string, ReadonlyMap<string, unknown>>([
  ["otto-visualizer", new Map([["@getpaseo/plugin/client/otto-visualizer", visualizerUi]])],
  [
    "otto-architectural-views",
    new Map([["@getpaseo/plugin/client/otto-architectural-views", viewUi]]),
  ],
  ["otto-schedules", new Map([["@getpaseo/plugin/client/otto-schedules", scheduleUi]])],
  ["otto-workflows", new Map([["@getpaseo/plugin/client/otto-workflows", workflowUi]])],
  ["otto-speech", new Map([["@getpaseo/plugin/client/otto-speech", speechUi]])],
  [
    "otto-integrations",
    new Map<string, unknown>([
      ["@getpaseo/plugin/client/otto-connectors", connectorUi],
      ["@getpaseo/plugin/client/otto-bitbucket", bitbucketUi],
    ]),
  ],
  ["otto-artifacts", new Map([["@getpaseo/plugin/client/otto-artifacts", artifactUi]])],
  ["otto-browser", new Map([["@getpaseo/plugin/client/otto-preview", previewUi]])],
  ["otto-project-knowledge", new Map([["@getpaseo/plugin/client/otto-knowledge", knowledgeUi]])],
]);
/** Public structural contracts are shared; private UI bridges are built-in-only. */
export function ottoClientModule(pluginId: string, name: string): unknown {
  return builtinUi.get(pluginId)?.get(name) ?? shared.get(name);
}
