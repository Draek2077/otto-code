import type { ReactElement } from "react";
import { ArtifactHtmlView } from "@/components/artifacts/artifact-html-view";

export interface ArchitecturalViewHtmlProps {
  html: string;
}

/**
 * A Knowledge Architectural View is a daemon-sanitized, interactive HTML
 * document. It intentionally shares Otto's one hardened HTML isolation layer
 * with Artifacts while keeping the product surface and ownership distinct.
 */
export function ArchitecturalViewHtml({ html }: ArchitecturalViewHtmlProps): ReactElement {
  return <ArtifactHtmlView html={html} />;
}
