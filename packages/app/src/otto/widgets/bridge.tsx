import { lazy, Suspense } from "react";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { WidgetPayload } from "@getpaseo/protocol/widgets/types";

export {
  readWidgetPayload,
  WidgetPayloadSchema as widgetPayloadSchema,
} from "@getpaseo/protocol/widgets/types";

const InlineWidget = lazy(async () => ({ default: (await import("./plugin-ui")).ChatWidget }));

// Registering timeline extensions must not load their renderers into every chat.
export function ChatWidget(props: PluginTimelineItemProps<WidgetPayload>) {
  return (
    <Suspense fallback={null}>
      <InlineWidget {...props} />
    </Suspense>
  );
}
