import type { MarkdownRendererProps } from "@/components/markdown/renderer";

/**
 * Provider text is untrusted text, not provider-declared rich content. Render
 * the common Markdown subset Otto already uses for chat, but never translate
 * embedded HTML or fetch a provider-supplied remote image.
 */
export function adaptCommunicationsMessageContent(
  text: string,
): Pick<
  MarkdownRendererProps,
  "text" | "enableHtmlish" | "remoteImages" | "workspaceImages" | "onToggleTask"
> {
  return {
    text,
    enableHtmlish: false,
    remoteImages: "altText",
    workspaceImages: null,
    onToggleTask: null,
  };
}
