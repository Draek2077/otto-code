import type { CSSProperties, ReactElement } from "react";

export interface ArtifactHtmlViewProps {
  html: string;
}

const IFRAME_STYLE: CSSProperties = {
  flex: 1,
  width: "100%",
  height: "100%",
  border: "none",
  background: "#fff",
};

/** Web renderer for artifact HTML. A sandboxed iframe isolates the artifact from
 * the host app: scripts run (interactive prototypes work) but the frame cannot
 * reach the parent document because `allow-same-origin` is intentionally omitted. */
export function ArtifactHtmlView({ html }: ArtifactHtmlViewProps): ReactElement {
  return (
    <iframe
      title="artifact"
      srcDoc={html}
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
      style={IFRAME_STYLE}
    />
  );
}
