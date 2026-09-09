import { View } from "react-native";
import {
  createMarkdownHeadingNavigationRules,
  MarkdownRenderer,
} from "@/components/markdown/renderer";
import type { KnowledgeReviewSurfaceProps } from "./knowledge-review-surface.types";

/** The web implementation adds selection-anchored review controls. */
export function KnowledgeReviewSurface({
  source,
  onLinkPress,
  onHeadingLayout,
}: KnowledgeReviewSurfaceProps) {
  return (
    <View>
      <MarkdownRenderer
        text={source}
        remoteImages="altText"
        rules={
          onHeadingLayout
            ? createMarkdownHeadingNavigationRules({ text: source, onHeadingLayout })
            : undefined
        }
        onLinkPress={onLinkPress}
      />
    </View>
  );
}
