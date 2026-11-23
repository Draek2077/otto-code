import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  ChatWidget,
  readWidgetPayload,
  widgetPayloadSchema,
} from "@getpaseo/plugin/client/otto-widgets";

export default function contribute(client: PluginClientContext) {
  const render = client.addTimelineRenderer({
    kind: "otto-widget",
    version: 1,
    schema: widgetPayloadSchema,
    Component: ChatWidget,
  });
  const transform = client.addTimelineTransformer({
    id: "otto-inline-widgets",
    query: { itemType: "tool_call" },
    transform: ({ item }) => {
      if (item.status === "failed" || item.status === "canceled") return;
      const data = readWidgetPayload(item.metadata);
      if (!data) return;
      return { items: [{ type: "plugin", kind: "otto-widget", version: 1, data }] };
    },
  });
  return async () => {
    await transform();
    await render();
  };
}
