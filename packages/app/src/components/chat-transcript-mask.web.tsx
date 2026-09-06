import type { CSSProperties, ReactNode } from "react";
import { WEB_SCROLLBAR_SIZE_PX } from "@/styles/web-scrollbar";
import { useChatVisualizerBackground } from "@/visualizer/chat-background-context";

const containerStyle: CSSProperties = { flex: 1, minHeight: 0, position: "relative" };
const maskStyle: CSSProperties = {
  ...containerStyle,
  // Fade the transcript itself so the animated canvas shows through. A painted
  // color overlay cannot match stars or the moving spotlight behind the chat.
  maskImage:
    "linear-gradient(to bottom, transparent, #0008 6px, #000 24px, #000 calc(100% - 24px), #0008 calc(100% - 6px), transparent), linear-gradient(#000, #000)",
  // The web strategy's scrollbar is inside the scroller. Keep its gutter opaque
  // in the mask; outline/jump controls are siblings outside this wrapper.
  maskSize: `100% 100%, ${WEB_SCROLLBAR_SIZE_PX}px 100%`,
  maskPosition: "0 0, right top",
  maskRepeat: "no-repeat",
};

export function ChatTranscriptMask({ children }: { children: ReactNode }) {
  const enabled = useChatVisualizerBackground();
  // Keep the wrapper mounted in both modes, preserving the scroller and reader.
  return (
    <div style={enabled ? maskStyle : containerStyle} data-testid="chat-transcript-mask">
      {children}
    </div>
  );
}
