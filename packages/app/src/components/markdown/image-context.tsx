import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { isDirectImageSrc, type HtmlishOptions } from "./html-ish";
import { resolveWorkspaceImagePath, type WorkspaceImageBase } from "./workspace-image-source";
import {
  loadWorkspaceImage,
  type WorkspaceImageAsset,
  type WorkspaceImageReader,
} from "./workspace-image-cache";

/**
 * What a rendered document is allowed to draw, and where it may draw it from.
 *
 * Both image paths — markdown `![](x)` and translated `<img src="x">` — end up
 * in {@link useMarkdownImageSource}, so the scheme gate and the workspace
 * resolution are decided once rather than twice.
 */
export interface WorkspaceImageSource {
  base: WorkspaceImageBase;
  /** The daemon read; supplied by the surface so this module owns no transport. */
  reader: WorkspaceImageReader;
}

interface MarkdownImageContextValue {
  remoteImages: NonNullable<HtmlishOptions["remoteImages"]>;
  workspaceImages: WorkspaceImageSource | null;
}

const DEFAULT_CONTEXT: MarkdownImageContextValue = {
  remoteImages: "load",
  workspaceImages: null,
};

const MarkdownImageContext = createContext<MarkdownImageContextValue>(DEFAULT_CONTEXT);

export function MarkdownImageProvider({
  remoteImages,
  workspaceImages,
  children,
}: {
  remoteImages: HtmlishOptions["remoteImages"];
  workspaceImages: WorkspaceImageSource | null;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({ remoteImages: remoteImages ?? "load", workspaceImages }),
    [remoteImages, workspaceImages],
  );
  return <MarkdownImageContext.Provider value={value}>{children}</MarkdownImageContext.Provider>;
}

export type MarkdownImageSource = { kind: "uri"; uri: string } | { kind: "svg"; xml: string };

export interface MarkdownImageResolution {
  /** What to draw, or `null` when nothing may be drawn — the caller shows alt text. */
  source: MarkdownImageSource | null;
  /** A workspace read is in flight. Not a failure yet, so draw nothing rather than alt text. */
  pending: boolean;
}

/**
 * Turn an author-supplied src into something drawable.
 *
 * A workspace-relative src is resolved, contained and read through the daemon;
 * everything else faces the scheme allowlist it always did. The raw src of a
 * relative image never becomes an `<Image>` source — only the store URL the read
 * produced — which is what keeps `remoteImages: "altText"` meaningful.
 */
export function useMarkdownImageSource(src: string): MarkdownImageResolution {
  const { remoteImages, workspaceImages } = useContext(MarkdownImageContext);
  const workspacePath = useMemo(
    () => (workspaceImages ? resolveWorkspaceImagePath(src, workspaceImages.base) : null),
    [src, workspaceImages],
  );

  const [asset, setAsset] = useState<WorkspaceImageAsset | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!workspaceImages || !workspacePath) {
      setAsset(null);
      setPending(false);
      return;
    }

    let cancelled = false;
    setPending(true);
    void (async () => {
      const loaded = await loadWorkspaceImage({
        reader: workspaceImages.reader,
        base: workspaceImages.base,
        path: workspacePath,
      });
      if (cancelled) {
        return;
      }
      setAsset(loaded);
      setPending(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceImages, workspacePath]);

  const attachmentUri = useAttachmentPreviewUrl(
    asset?.kind === "attachment" ? asset.attachment : null,
  );

  return useMemo(() => {
    if (workspacePath) {
      if (asset?.kind === "svg") {
        return { source: { kind: "svg", xml: asset.xml }, pending: false };
      }
      if (asset?.kind === "attachment") {
        return attachmentUri
          ? { source: { kind: "uri", uri: attachmentUri }, pending: false }
          : { source: null, pending: true };
      }
      return { source: null, pending };
    }

    return isDirectImageSrc(src, { remoteImages })
      ? { source: { kind: "uri", uri: src }, pending: false }
      : { source: null, pending: false };
  }, [asset, attachmentUri, pending, remoteImages, src, workspacePath]);
}
