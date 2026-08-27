import { View } from "react-native";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import type { KnowledgeReviewSurfaceProps } from "./knowledge-review-surface.types";

/** Native keeps the article readable while the desktop selection workflow lands. */
export function KnowledgeReviewSurface({ source }: KnowledgeReviewSurfaceProps) {
  return (
    <View>
      <MarkdownRenderer text={source} remoteImages="altText" />
    </View>
  );
}
