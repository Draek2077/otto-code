import { lazy, Suspense } from "react";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { SuggestedTaskCardData } from "@getpaseo/plugin/otto/suggested-task";

export { suggestedTaskSchema } from "@getpaseo/plugin/otto/suggested-task";

const Card = lazy(async () => ({ default: (await import("./card")).SuggestedTaskCard }));

export function SuggestedTaskCard(props: PluginTimelineItemProps<SuggestedTaskCardData>) {
  return (
    <Suspense fallback={null}>
      <Card {...props} />
    </Suspense>
  );
}
