import { createHash } from "node:crypto";
import * as fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveOttoHome } from "../../otto-home.js";
import type { AgentTimelineItem } from "../agent-sdk-types.js";
import {
  selectMaterializedImagesToClear,
  selectStaleMaterializedImages,
  type MaterializedImageCandidate,
} from "./provider-image-retention.js";

export interface ProviderImageOutput {
  path?: string | null;
  url?: string | null;
  data?: string | null;
  mimeType?: string | null;
  altText?: string | null;
}

export interface MaterializedProviderImage {
  path: string;
}

// An image a provider handed back as bytes (a browser screenshot, a Read of a
// PNG) has to become a file before the timeline can point at it. That file is
// the *record*: the assistant markdown carries its path, so every later render
// of that message - days later, after a daemon restart - reads it back.
//
// It used to live in a per-process `mkdtemp` under the OS temp dir, which was
// wrong twice over. Nothing ever removed those directories, so they piled up
// one per daemon start; and the OS removes their *contents* on its own schedule
// (Windows Storage Sense, /tmp sweepers), so screenshots vanished out from under
// transcripts that were still on screen. Unbounded growth and silent data loss,
// from the same choice.
//
// They live under $OTTO_HOME now: one directory, ours to age out, and the same
// place every other piece of daemon state a user might want to reclaim already
// lives. See docs/attachment-lifecycle.md.
const PROVIDER_IMAGE_ATTACHMENT_DIR = "otto-attachments";
const PROVIDER_IMAGE_ATTACHMENT_DIR_PREFIX = `${PROVIDER_IMAGE_ATTACHMENT_DIR}-`;
const MATERIALIZED_IMAGE_DIR_NAME = "attachments";
// A sent image is user content, unlike provider screenshots and tool output.
// It must survive the cache's age/size sweep so another client can render the
// message for as long as the chat itself exists.
const SENT_IMAGE_ATTACHMENT_DIR_NAME = "sent-attachments";
const PRIVATE_ATTACHMENT_DIR_MODE = 0o700;
const MATERIALIZED_IMAGE_FILE_MODE = 0o600;

/** Content-hashed filenames: `<sha256>.<ext>`. The sweep matches on this shape. */
const MATERIALIZED_IMAGE_FILE = /^[0-9a-f]{64}\.[a-z0-9]+$/;

/**
 * The directory, ensured. Deliberately not memoized: the old implementation
 * cached an `mkdtemp` path and had to re-check it on every write anyway, since
 * a temp sweeper could delete it mid-session. `mkdirSync` with `recursive` is
 * idempotent and cheap next to the image write it precedes, so ensuring beats
 * caching-then-validating.
 */
export function getMaterializedImageAttachmentDir(ottoHome?: string): string {
  return ensurePrivateAttachmentDir(MATERIALIZED_IMAGE_DIR_NAME, ottoHome);
}

/** The daemon-owned record for images the user sends in a prompt. */
export function getSentImageAttachmentDir(ottoHome?: string): string {
  return ensurePrivateAttachmentDir(SENT_IMAGE_ATTACHMENT_DIR_NAME, ottoHome);
}

function ensurePrivateAttachmentDir(directoryName: string, ottoHome?: string): string {
  const dir = path.join(ottoHome ?? resolveOttoHome(), directoryName);
  fsSync.mkdirSync(dir, { recursive: true, mode: PRIVATE_ATTACHMENT_DIR_MODE });
  try {
    fsSync.chmodSync(dir, PRIVATE_ATTACHMENT_DIR_MODE);
  } catch {
    // A pre-existing directory we cannot chmod is still usable; the mode is
    // defence in depth on a path only this user's daemon writes to.
  }
  return dir;
}

function getImageExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/tiff":
      return "tiff";
    default:
      return "bin";
  }
}

function normalizeImageData(mimeType: string, data: string): { mimeType: string; data: string } {
  if (data.startsWith("data:")) {
    const match = data.match(/^data:([^;]+);base64,(.*)$/);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
  }
  return { mimeType, data };
}

// Filenames are a content hash of the bytes so re-materializing the same image
// reuses the existing file instead of leaking a fresh one for repeated image
// blocks or history replay. The rewrite is also what keeps a live transcript's
// images young: the sweep ages files out by mtime, and re-use is a write.
export function materializeProviderImage(image: {
  data: string;
  mimeType: string | null;
}): MaterializedProviderImage {
  return materializeImage(image, getMaterializedImageAttachmentDir());
}

/**
 * Mirrors a user-submitted image into durable daemon storage. This deliberately
 * does not share the provider-image retention policy: a timeline reference to
 * user content must not silently expire while the message remains in history.
 */
export function materializeSentImageAttachment(image: {
  data: string;
  mimeType: string | null;
}): MaterializedProviderImage {
  return materializeImage(image, getSentImageAttachmentDir());
}

function materializeImage(
  image: { data: string; mimeType: string | null },
  attachmentsDir: string,
): MaterializedProviderImage {
  const normalized = normalizeImageData(image.mimeType ?? "image/png", image.data);
  const bytes = Buffer.from(normalized.data, "base64");
  const extension = getImageExtension(normalized.mimeType);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const filePath = path.join(attachmentsDir, `${hash}.${extension}`);
  fsSync.writeFileSync(filePath, bytes, { mode: MATERIALIZED_IMAGE_FILE_MODE });
  fsSync.chmodSync(filePath, MATERIALIZED_IMAGE_FILE_MODE);
  return { path: filePath };
}

// Recognizes markdown rendered for a materialized provider image: its source is a content-hashed
// file in the attachments dir. Matching the full <hash>.<ext> shape (not just a leading "![")
// keeps user-authored text from being mistaken for a provider image during history replay. The
// separator still accepts old doubled-backslash Windows history; new Windows output uses file URIs.
//
// Both directory shapes stay recognized: `$OTTO_HOME/attachments/` is where new images land, and
// `otto-attachments[-suffix]/` is the retired temp-dir layout that older transcripts still name.
const PROVIDER_IMAGE_MARKDOWN = new RegExp(
  `^!\\[[^\\]]*\\]\\([^)]*(?:${PROVIDER_IMAGE_ATTACHMENT_DIR}(?:-[^/\\\\)]+)?|${MATERIALIZED_IMAGE_DIR_NAME})[/\\\\]+(?:[^/\\\\)]+[/\\\\]+)?[0-9a-f]{64}\\.[a-z0-9]+\\)`,
);

export function isProviderImageMarkdown(text: string): boolean {
  return PROVIDER_IMAGE_MARKDOWN.test(text);
}

// The shipped policy. Days and megabytes are the source of truth because those
// are the units the setting is expressed in - the daemon config carries them
// verbatim, and a user editing them should see the same numbers the code has.
// 0 on either disables that lever.

/** Days without being re-materialized before an image is stale. */
export const DEFAULT_ATTACHMENT_IMAGE_MAX_AGE_DAYS = 30;
/** ~4,500 screenshots at the ~110 KB a normalized capture actually measures. */
export const DEFAULT_ATTACHMENT_IMAGE_MAX_TOTAL_MB = 512;

export const MATERIALIZED_IMAGE_MAX_AGE_MS =
  DEFAULT_ATTACHMENT_IMAGE_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000;
export const MATERIALIZED_IMAGE_MAX_TOTAL_BYTES =
  DEFAULT_ATTACHMENT_IMAGE_MAX_TOTAL_MB * 1024 * 1024;
/** A temp directory nobody has written to in a week belongs to no live daemon. */
const LEGACY_DIR_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Every content-hashed image in the store, with the size and mtime both the
 * retention policy and the Storage readout need. Non-conforming files are
 * skipped, never reported and never deleted - the directory is ours, but a
 * stray file in it is not ours to remove.
 */
export function listMaterializedProviderImages(ottoHome?: string): MaterializedImageCandidate[] {
  const dir = getMaterializedImageAttachmentDir(ottoHome);

  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: MaterializedImageCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !MATERIALIZED_IMAGE_FILE.test(entry.name)) {
      continue;
    }
    try {
      const stats = fsSync.statSync(path.join(dir, entry.name));
      files.push({ name: entry.name, sizeBytes: stats.size, modifiedAtMs: stats.mtimeMs });
    } catch {
      // Raced with a sweep or a manual delete; nothing to report.
    }
  }
  return files;
}

export interface MaterializedImageStats {
  fileCount: number;
  totalBytes: number;
  /** Epoch ms of the oldest image, or null when the store is empty. */
  oldestAtMs: number | null;
}

/** What the Storage readout shows: how much is here, and since when. */
export function readMaterializedImageStats(ottoHome?: string): MaterializedImageStats {
  const files = listMaterializedProviderImages(ottoHome);
  let totalBytes = 0;
  let oldestAtMs: number | null = null;
  for (const file of files) {
    totalBytes += file.sizeBytes;
    if (oldestAtMs === null || file.modifiedAtMs < oldestAtMs) {
      oldestAtMs = file.modifiedAtMs;
    }
  }
  return { fileCount: files.length, totalBytes, oldestAtMs };
}

export interface SweepMaterializedImagesResult {
  deleted: number;
  freedBytes: number;
}

/**
 * Ages the materialized-image store down to the retention policy. Runs at
 * daemon start and daily after that; safe to call concurrently with writes,
 * because a file the sweep deletes out from under a live transcript is
 * re-materialized by the next tool call that produces it.
 */
export function sweepMaterializedProviderImages(
  options: {
    ottoHome?: string;
    now?: number;
    maxAgeMs?: number;
    maxTotalBytes?: number;
  } = {},
): SweepMaterializedImagesResult {
  const files = listMaterializedProviderImages(options.ottoHome);
  const doomed = selectStaleMaterializedImages({
    files,
    now: options.now ?? Date.now(),
    maxAgeMs: options.maxAgeMs ?? MATERIALIZED_IMAGE_MAX_AGE_MS,
    maxTotalBytes: options.maxTotalBytes ?? MATERIALIZED_IMAGE_MAX_TOTAL_BYTES,
  });

  const { deleted, freedBytes } = deleteMaterializedImages({
    ottoHome: options.ottoHome,
    names: doomed,
    files,
  });
  return { deleted, freedBytes };
}

export interface ClearMaterializedImagesResult {
  matched: number;
  deleted: number;
  freedBytes: number;
}

/**
 * The user-triggered clear behind `attachments.images.clear`. `dryRun` reports
 * what would go without touching anything, so the confirm dialog can quote a
 * real count and a real size before the user commits.
 */
export function clearMaterializedProviderImages(options: {
  ottoHome?: string;
  olderThanDays?: number;
  dryRun?: boolean;
  now?: number;
}): ClearMaterializedImagesResult {
  const files = listMaterializedProviderImages(options.ottoHome);
  const names = selectMaterializedImagesToClear({
    files,
    now: options.now ?? Date.now(),
    olderThanDays: options.olderThanDays ?? 0,
  });

  if (options.dryRun !== false) {
    const matchedSet = new Set(names);
    const freedBytes = files
      .filter((file) => matchedSet.has(file.name))
      .reduce((total, file) => total + file.sizeBytes, 0);
    return { matched: names.length, deleted: 0, freedBytes };
  }

  const { deleted, freedBytes } = deleteMaterializedImages({
    ottoHome: options.ottoHome,
    names,
    files,
  });
  return { matched: names.length, deleted, freedBytes };
}

function deleteMaterializedImages(input: {
  ottoHome?: string;
  names: readonly string[];
  files: readonly MaterializedImageCandidate[];
}): { deleted: number; freedBytes: number } {
  if (input.names.length === 0) {
    return { deleted: 0, freedBytes: 0 };
  }

  const dir = getMaterializedImageAttachmentDir(input.ottoHome);
  const sizeByName = new Map(input.files.map((file) => [file.name, file.sizeBytes]));

  let deleted = 0;
  let freedBytes = 0;
  for (const name of input.names) {
    try {
      fsSync.rmSync(path.join(dir, name), { force: true });
      deleted += 1;
      freedBytes += sizeByName.get(name) ?? 0;
    } catch {
      // Locked or already gone. The next sweep picks it up.
    }
  }
  return { deleted, freedBytes };
}

export interface ReclaimLegacyImageDirsResult {
  removed: number;
  skipped: number;
}

/**
 * Removes the `otto-attachments-*` temp directories the retired layout left
 * behind - one per daemon start, forever, because nothing ever cleaned them up.
 *
 * Only *stale* directories go. A directory written to within the last week may
 * belong to a live daemon on an older build (this repo runs installed and dev
 * daemons side by side), and its transcripts still resolve through those paths.
 * Empty directories - the bulk of the mess - are always stale.
 */
export function reclaimLegacyProviderImageDirs(
  options: { tmpDir?: string; now?: number; staleAfterMs?: number } = {},
): ReclaimLegacyImageDirsResult {
  const tmpDir = options.tmpDir ?? os.tmpdir();
  const now = options.now ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? LEGACY_DIR_STALE_AFTER_MS;

  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(tmpDir, { withFileTypes: true });
  } catch {
    return { removed: 0, skipped: 0 };
  }

  let removed = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(PROVIDER_IMAGE_ATTACHMENT_DIR_PREFIX)) {
      continue;
    }

    const dirPath = path.join(tmpDir, entry.name);
    try {
      if (newestWriteMs(dirPath) > now - staleAfterMs) {
        skipped += 1;
        continue;
      }
      fsSync.rmSync(dirPath, { recursive: true, force: true });
      removed += 1;
    } catch {
      skipped += 1;
    }
  }

  return { removed, skipped };
}

/** Newest mtime among a directory's files, or -Infinity when it holds none. */
function newestWriteMs(dirPath: string): number {
  let newest = Number.NEGATIVE_INFINITY;
  for (const entry of fsSync.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    try {
      newest = Math.max(newest, fsSync.statSync(path.join(dirPath, entry.name)).mtimeMs);
    } catch {
      // Unreadable entry: treat the directory as in use rather than guess.
      return Number.POSITIVE_INFINITY;
    }
  }
  return newest;
}

interface RenderProviderImageOutputOptions {
  materialize?: (image: { data: string; mimeType: string | null }) => MaterializedProviderImage;
}

function nonEmptyString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isDataImageSource(source: string): boolean {
  return source.trim().toLowerCase().startsWith("data:image/");
}

function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function encodeFilePath(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function windowsFileUri(value: string): string | null {
  const isWindowsNetworkPath = value.startsWith("\\\\");
  let normalizedPath = value.replace(/\\/g, "/");
  if (/^\/\/\?\/UNC\//i.test(normalizedPath)) {
    normalizedPath = `//${normalizedPath.slice(8)}`;
  } else if (/^\/\/\?\/[A-Za-z]:\//.test(normalizedPath)) {
    normalizedPath = normalizedPath.slice(4);
  }

  if (/^[A-Za-z]:\//.test(normalizedPath)) {
    const drive = normalizedPath.slice(0, 2);
    return `file:///${drive}${encodeFilePath(normalizedPath.slice(2))}`;
  }
  if (isWindowsNetworkPath && normalizedPath.startsWith("//")) {
    return `file:${encodeFilePath(normalizedPath)}`;
  }
  return null;
}

function markdownImageSource(value: string): string {
  const windowsUri = windowsFileUri(value);
  if (windowsUri) {
    return windowsUri;
  }
  if (value.startsWith("/")) {
    return `file://${encodeFilePath(value)}`;
  }
  return value;
}

function escapeMarkdownImageSource(value: string): string {
  return markdownImageSource(value).replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
}

export function renderProviderImageOutputAsAssistantMarkdown(
  image: ProviderImageOutput,
  options: RenderProviderImageOutputOptions = {},
): AgentTimelineItem | null {
  const source = nonEmptyString(image.path) ?? nonEmptyString(image.url);
  if (source && !isDataImageSource(source)) {
    const altText = escapeMarkdownImageAlt(nonEmptyString(image.altText) ?? "Image");
    return {
      type: "assistant_message",
      text: `![${altText}](${escapeMarkdownImageSource(source)})`,
    };
  }

  const data = nonEmptyString(image.data) ?? (source && isDataImageSource(source) ? source : null);
  if (!data) {
    return null;
  }

  let materialized: MaterializedProviderImage | null = null;
  try {
    materialized = options.materialize
      ? options.materialize({
          data,
          mimeType: nonEmptyString(image.mimeType),
        })
      : null;
  } catch {
    materialized = null;
  }
  if (!materialized?.path || isDataImageSource(materialized.path)) {
    return {
      type: "assistant_message",
      text: "Image output was omitted because it was not available as a file path or URL.",
    };
  }

  const altText = escapeMarkdownImageAlt(nonEmptyString(image.altText) ?? "Image");
  return {
    type: "assistant_message",
    text: `![${altText}](${escapeMarkdownImageSource(materialized.path)})`,
  };
}
