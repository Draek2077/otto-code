import { View } from "react-native";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import type { KnowledgeReviewSurfaceProps } from "./knowledge-review-surface.types";

/** The web implementation adds selection-anchored review controls. */
export function KnowledgeReviewSurface({ source }: KnowledgeReviewSurfaceProps) {
  return (
    <View>
      <MarkdownRenderer text={source} remoteImages="altText" />
    </View>
  );
}
