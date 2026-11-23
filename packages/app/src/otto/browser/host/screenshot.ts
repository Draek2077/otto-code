import type { AttachmentMetadata, BrowserElementAttachment } from "@/attachments/types";
/** Page screenshot context, without fabricating inspected element markup or CSS. */
export function hostPageScreenshot(input: {
  url: string;
  width: number;
  height: number;
  screenshot: AttachmentMetadata;
}): BrowserElementAttachment {
  return {
    url: input.url,
    selector: ":root",
    tag: "html",
    text: "",
    outerHTML: "",
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: input.width, height: input.height },
    reactSource: null,
    parentChain: [],
    children: [],
    screenshot: input.screenshot,
    formatted: `Host Browser viewport screenshot\nURL: ${input.url}\nUse browser tools to inspect the page DOM.`,
  };
}
