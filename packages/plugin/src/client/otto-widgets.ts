import type { ComponentType } from "react";
import type { WidgetPayload } from "@getpaseo/protocol/widgets/types";
import type { PluginTimelineItemProps } from "./contracts.js";

export declare const ChatWidget: ComponentType<PluginTimelineItemProps<WidgetPayload>>;
export {
  readWidgetPayload,
  WidgetPayloadSchema as widgetPayloadSchema,
} from "@getpaseo/protocol/widgets/types";
