import type { WidgetPayload } from "@getpaseo/protocol/widgets/types";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { WidgetCard } from "./widget-card";
import { WidgetChatProvider } from "./widget-chat-context";

export function ChatWidget({ agentId, host, item }: PluginTimelineItemProps<WidgetPayload>) {
  return (
    <WidgetChatProvider serverId={host.id} agentId={agentId}>
      <WidgetCard payload={item.data} />
    </WidgetChatProvider>
  );
}
export {
  readWidgetPayload,
  WidgetPayloadSchema as widgetPayloadSchema,
} from "@getpaseo/protocol/widgets/types";
