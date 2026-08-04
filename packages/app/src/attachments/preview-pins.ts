// Preview attachments are the local copies the UI persists so a daemon-side
// image has a URL it can render from: an assistant markdown image (a browser
// screenshot, a Read of a PNG), or the image a file tab is showing. They belong
// to no draft, no queued message and no workspace attachment, so the draft
// store's attachment GC - which runs on every draft save, every lifecycle
// change and once on rehydrate - saw them as unreferenced and deleted the file
// microseconds after it was written. The chat then had a URL pointing at
// nothing and rendered "Unable to load image preview."
//
// Minting a preview id pins it, and the GC treats pinned ids as referenced.
// Pinning happens at id creation (before the bytes are written), so there is no
// window where a file exists unpinned.
//
// The pin set is capped so a long-lived desktop session cannot grow the
// attachment directory without bound. Evicted ids become collectable again;
// React Query drops the matching metadata on its own gcTime, so an image that
// far back in the scrollback refetches and re-pins when it is next rendered.
const MAX_PINNED_PREVIEW_ATTACHMENTS = 512;

/**
 * What marks an attachment as a regenerable copy rather than user content. The
 * Storage section reports and clears the two apart on this, and every store
 * implementation reads it, so it lives here with the rest of the preview
 * concept rather than being spelled out at each site.
 */
export const PREVIEW_ATTACHMENT_ID_PREFIX = "preview_";

export function isPreviewAttachmentId(id: string): boolean {
  return id.startsWith(PREVIEW_ATTACHMENT_ID_PREFIX);
}

const pinnedPreviewAttachmentIds = new Set<string>();

export function pinPreviewAttachmentId(id: string): void {
  // Delete-then-add moves an existing id to the end of the insertion order, so
  // the cap evicts the least recently minted rather than the first ever minted.
  pinnedPreviewAttachmentIds.delete(id);
  pinnedPreviewAttachmentIds.add(id);

  while (pinnedPreviewAttachmentIds.size > MAX_PINNED_PREVIEW_ATTACHMENTS) {
    const oldest = pinnedPreviewAttachmentIds.values().next();
    if (oldest.done) {
      return;
    }
    pinnedPreviewAttachmentIds.delete(oldest.value);
  }
}

export function collectPinnedPreviewAttachmentIds(target: Set<string>): void {
  for (const id of pinnedPreviewAttachmentIds) {
    target.add(id);
  }
}

/**
 * Drops every pin. Paired with clearing the preview attachments themselves - a
 * pin for a file that no longer exists protects nothing and only holds the id
 * against whatever is minted next.
 */
export function clearPinnedPreviewAttachmentIds(): void {
  pinnedPreviewAttachmentIds.clear();
}

/** Test-only alias: the pin set is module state that outlives an individual test. */
export function __resetPinnedPreviewAttachmentIdsForTests(): void {
  pinnedPreviewAttachmentIds.clear();
}
