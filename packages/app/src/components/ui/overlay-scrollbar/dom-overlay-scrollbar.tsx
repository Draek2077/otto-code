import React, { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { OverlayScrollbar, type OverlayScrollbarMetrics } from "./overlay-scrollbar";

export function DomOverlayScrollbar({
  scrollContainerRef,
  onUserScrollUp,
}: {
  scrollContainerRef: RefObject<HTMLElement | null>;
  onUserScrollUp: () => void;
}) {
  const [metrics, setMetrics] = useState<OverlayScrollbarMetrics>({
    offset: 0,
    viewportSize: 0,
    contentSize: 0,
  });
  const syncMetrics = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    const next = {
      offset: Math.max(0, scrollContainer.scrollTop),
      viewportSize: Math.max(0, scrollContainer.clientHeight),
      contentSize: Math.max(0, scrollContainer.scrollHeight),
    };
    setMetrics((current) =>
      current.offset === next.offset &&
      current.viewportSize === next.viewportSize &&
      current.contentSize === next.contentSize
        ? current
        : next,
    );
  }, [scrollContainerRef]);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    syncMetrics();
    scrollContainer.addEventListener("scroll", syncMetrics, { passive: true });
    const observer = new ResizeObserver(syncMetrics);
    observer.observe(scrollContainer);
    const content = scrollContainer.firstElementChild;
    if (content) observer.observe(content);
    return () => {
      scrollContainer.removeEventListener("scroll", syncMetrics);
      observer.disconnect();
    };
  }, [scrollContainerRef, syncMetrics]);

  const scrollToOffset = useCallback(
    (offset: number) => {
      const scrollContainer = scrollContainerRef.current;
      if (scrollContainer) scrollContainer.scrollTop = offset;
    },
    [scrollContainerRef],
  );

  return (
    <OverlayScrollbar
      metrics={metrics}
      onScrollToOffset={scrollToOffset}
      onUserScrollUp={onUserScrollUp}
    />
  );
}
