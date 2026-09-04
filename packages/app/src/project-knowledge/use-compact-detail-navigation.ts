import { useCallback, useEffect, useState } from "react";

/**
 * A phone has room for either the browser or the article, never both. Keep
 * that navigation state separate from the selected article: Back returns to
 * the browser with its selection intact rather than clearing the reader.
 */
export function useCompactDetailNavigation(isCompact: boolean): {
  showsDetail: boolean;
  openDetail: () => void;
  goBack: () => void;
} {
  const [detailOpen, setDetailOpen] = useState(false);

  // A desktop selection must not turn into an unexpected drill-down when the
  // viewport later becomes compact.
  useEffect(() => {
    if (!isCompact) setDetailOpen(false);
  }, [isCompact]);

  const openDetail = useCallback(() => {
    if (isCompact) setDetailOpen(true);
  }, [isCompact]);
  const goBack = useCallback(() => setDetailOpen(false), []);

  return { showsDetail: isCompact && detailOpen, openDetail, goBack };
}
