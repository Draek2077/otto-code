# Attachment lifecycle

Agents and people produce image bytes - browser screenshots, `Read` of a PNG, a chart a tool
rendered, or a photo sent from a phone - and those bytes have to become a file before every client
can show them. Four different stores end up holding them, with different owners and rules. Getting the tier wrong is how
you either leak disk forever or delete something the user was still looking at; both have happened.

| Tier                   | Where                                        | Owner  | Rule                                                                       |
| ---------------------- | -------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| **Materialized image** | `$OTTO_HOME/attachments/<sha256>.<ext>`      | daemon | The record. Aged out by policy, never by reference count.                  |
| **Sent-image record**  | `$OTTO_HOME/sent-attachments/<sha256>.<ext>` | daemon | Cross-client record of user image content. Never aged out.                 |
| **Preview attachment** | app attachment store, id `preview_*`         | app    | A cache of the tier above. Pinned while live, collected when it is not.    |
| **Sent attachment**    | app attachment store, id `att_*`             | app    | The user's own content. Referenced by drafts and messages. Never aged out. |

## Tier 1 - materialized images are the record, not a cache

`materializeProviderImage` (`packages/server/src/server/agent/providers/provider-image-output.ts`)
writes the bytes and returns a path, and the provider emits `![alt](file:///…)` into the timeline.
That markdown is persisted. Every later render of that message - tomorrow, after a daemon restart -
reads the file back. **Nothing regenerates it.** The tool call that produced it is long finished.

So it is not a cache, and the two properties it needs are the two the old implementation broke:

- **It must outlive the process.** It used to live in a per-daemon-start `mkdtemp` under the OS temp
  directory. Nothing ever removed those directories, so they accumulated one per daemon start - and
  the OS removed their _contents_ on its own schedule, so screenshots disappeared from transcripts
  that were still open. Unbounded growth and silent data loss, from one choice.
- **It must be bounded by something we control.** `$OTTO_HOME/attachments` is one directory, ours to
  age out, next to every other piece of daemon state a user might want to reclaim.

Filenames are the SHA-256 of the bytes, so twenty screenshots of an unchanged page are one file, and
re-materializing rewrites the same path. That rewrite is load-bearing for retention: **re-use is a
write**, so an image that keeps appearing in a live transcript keeps its mtime fresh and only
genuinely cold bytes age out.

### The policy

`startMaterializedImageHousekeeping` runs at daemon start and daily after that (`unref`'d - never a
reason for the process to stay alive). Two levers, in `provider-image-output.ts`:

| Lever                                | Default | What it is for                                                           |
| ------------------------------------ | ------- | ------------------------------------------------------------------------ |
| `MATERIALIZED_IMAGE_MAX_AGE_MS`      | 30 days | The primary rule. Cold bytes go.                                         |
| `MATERIALIZED_IMAGE_MAX_TOTAL_BYTES` | 512 MB  | Backstop for a burst the age rule has not caught up with. ~4,500 images. |

`selectStaleMaterializedImages` (`provider-image-retention.ts`) is pure and separately tested, for
the reason `selectArchivedForDeletion` is: every name it returns is unlinked with no undo, and the
failure is silent - the transcript keeps its markdown and quietly renders alt text instead.

**This is a deliberate exception to "nothing deletes on a timer"** ([chat-lifecycle](chat-lifecycle.md)
holds that line for chat records). A chat record is the user's writing and is irreplaceable; a
screenshot from six weeks ago is a large binary whose loss degrades one old message to alt text. The
alternative is a directory that grows forever. The numbers are set so a normal user never reaches
either bound.

The startup pass also removes the retired `otto-attachments-*` temp directories, but only ones with
no file written in the last week - this repo runs installed and dev daemons side by side, and a
directory a live older daemon is still writing to is left alone.

### User-sent images have their own durable record

The sending device's `att_*` attachment remains local, which is useful for offline composition but
cannot render a message on another device. When the daemon records a submitted structured image
prompt, `materializeSentImageAttachment` writes the bytes to `$OTTO_HOME/sent-attachments` and the
canonical user timeline row carries only its path and MIME type. Other clients lazy-read that path
through the existing file RPC and persist their own preview cache.

This directory is deliberately outside the provider-image sweep. A sent image is user content, so
losing it after thirty days while the chat still exists would be data loss, not cache reclamation.

## Tier 2 - preview attachments are a cache, and must be pinned

The app cannot render a daemon-side path directly, so it reads the file over the file RPC and
persists a local copy: `client.readFile` → `persistAttachmentFromBytes` → `useAttachmentPreviewUrl`.
That copy is a **preview attachment**, ided by `createPreviewAttachmentId`, and it is the thing three
surfaces render from - `AssistantMarkdownImage` in chat, the workspace-image path in the markdown
viewer, and the file-tab image preview.

The draft store's GC (`runAttachmentGc`) owns the whole app attachment store and deletes anything it
cannot trace to a live reference: drafts, queued messages, pending creates, the live stream, the
workspace attachment store. **A preview attachment hangs off none of them.** It ran on every draft
save, so a keystroke deleted every screenshot in the transcript and the chat rendered "Unable to load
image preview" from then on.

`attachments/preview-pins.ts` is the fix. Minting a preview id pins it - inside
`createPreviewAttachmentId`, before the bytes are written, so no file ever exists unpinned - and the
GC counts pinned ids as referenced. The pin set is capped at 512 with the least recently minted
falling out first, so a long desktop session cannot grow the store without bound; React Query has
dropped the matching metadata by then, so an image that far back in the scrollback refetches and
re-pins when it is next rendered.

Deleting a preview attachment is always safe in principle - tier 1 can regenerate it - which is
exactly why the pin is a cap and not a permanent reference.

**The rule for the next feature that persists an attachment nobody sends:** if it does not hang off a
draft, a queued message or the workspace attachment store, it needs a reference in `runAttachmentGc`
or it will be deleted, quickly and silently.

## Tier 3 - sent attachments

`att_*` ids: images and files the user attached to a message. Referenced by the draft that holds
them and by the stream item once sent. Never swept by age or size - this is user content, and the
rule that governs it is the chat's, not this page's.

## The Storage section

Settings → a host → **Storage** is where a person sees and reclaims all of this. One row per store,
because "images: 812 MB" is a useless number when half of it is a cache you cannot lose and half is a
record you can:

| Row                          | Backed by                                     | Clearing it                                                                            |
| ---------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Images on this host          | `attachments.images.*` RPCs                   | Dry run, then a destructive confirm quoting the real count and size. Not undoable.     |
| Cached copies on this device | the app store's `usage()` / `clearPreviews()` | A plain action. Every byte is a copy of the row above, so the worst case is a refetch. |

Sent attachments are shown only as context inside the preview row's hint - their size, and the fact
that clearing never touches them. The daemon's replicated sent-image record is also excluded from
the reclaim controls. Offering to sweep the user's own content from a disk-space screen would be the
wrong default even with a confirm.

**The clear RPC follows `history.agents.clear_archived` exactly**: `dryRun: true` by default,
`olderThanDays: 0` meaning _everything_. That last point is a real trap, and why
`selectMaterializedImagesToClear` is a separate function from `selectStaleMaterializedImages` rather
than a parameterization: to the background sweep an age of zero **disables** the age rule, and to a
person who pressed "Clear" it means **take everything**. One function serving both readings is how
that becomes a data-loss bug.

`maxAgeDays` and `maxTotalMb` are editable in the same section and persist to daemon config. The
housekeeping reads them fresh on every pass, so an edit lands on the next sweep rather than at the
next daemon restart.

Gated by `server_info.features.attachmentStorage` (`COMPAT(attachmentStorage)`, v0.7.1). Per the
feature contract there is no fallback: an old daemon simply does not get the host half. The
device-local row still renders, because it needs no daemon at all.

## Deliberately not built

**Per-chat and per-workspace reclaim.** Filenames are a content hash, so the same bytes may be
referenced from three transcripts; "this workspace's images" is an ownership that does not exist and
would have to be invented - an index maintained at materialize time, kept honest across chat delete
and workspace archive. Age plus a global clear carries the feature. Revisit only if someone asks for
scope, and see `projects/README.md` before starting.
