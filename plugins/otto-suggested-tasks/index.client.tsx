import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  SuggestedTaskCard,
  suggestedTaskSchema,
} from "@getpaseo/plugin/client/otto-suggested-tasks";

export default function contribute(client: PluginClientContext) {
  return client.addTimelineRenderer({
    kind: "suggested-task",
    version: 1,
    Component: SuggestedTaskCard,
    schema: suggestedTaskSchema,
  });
}
