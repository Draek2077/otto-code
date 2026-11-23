import * as openai from "@getpaseo/plugin/server/otto-openai";
import * as brain from "@getpaseo/plugin/server/otto-brain";
import * as kanbanHost from "@getpaseo/plugin/server/otto-kanban";
import * as kanban from "@getpaseo/plugin/otto/kanban";
import * as openaiSettings from "@getpaseo/plugin/otto/openai-settings";
import * as atlassian from "@getpaseo/plugin/otto/atlassian-settings";
import * as bitbucket from "@getpaseo/plugin/otto/bitbucket-connections";
import * as connectors from "@getpaseo/plugin/otto/connectors";
import * as context from "@getpaseo/plugin/otto/context-management";
import * as knowledge from "@getpaseo/plugin/otto/project-knowledge";
import * as workflows from "@getpaseo/plugin/otto/workflows";
import * as schedules from "@getpaseo/plugin/otto/schedules";

/** Otto SDK namespace objects, supplied only after the host's client-only check.
 * These are the same public contracts and host libraries as the package exports,
 * not a second evaluator, permission layer, or copy of feature state. */
export const ottoPluginServerModules: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ["@getpaseo/plugin/server/otto-openai", openai],
  ["@getpaseo/plugin/server/otto-brain", brain],
  ["@getpaseo/plugin/server/otto-kanban", kanbanHost],
  ["@getpaseo/plugin/otto/kanban", kanban],
  ["@getpaseo/plugin/otto/openai-settings", openaiSettings],
  ["@getpaseo/plugin/otto/atlassian-settings", atlassian],
  ["@getpaseo/plugin/otto/bitbucket-connections", bitbucket],
  ["@getpaseo/plugin/otto/connectors", connectors],
  ["@getpaseo/plugin/otto/context-management", context],
  ["@getpaseo/plugin/otto/project-knowledge", knowledge],
  ["@getpaseo/plugin/otto/workflows", workflows],
  ["@getpaseo/plugin/otto/schedules", schedules],
]);
