import { encodeLinkPath, relativeLinkPath } from "./markdown-link-completion";

/**
 * The pure half of "paste or drop an image into a markdown document": what to
 * call the file, where under the workspace it goes, and what text lands at the
 * caret.
 *
 * Nothing here touches CodeMirror, the daemon, or the filesystem.
 * `markdown-commands.ts` wraps this into a CM6 handler and
 * `use-markdown-image-drop.ts` performs the write, exactly the way the
 * formatting transforms and the link completion are split.
 *
 * The path maths is `relativeLinkPath`, reused rather than restated: a link the
 * completion source writes and a link an image drop writes have to resolve the
 * same way, and two copies of that arithmetic would drift.
 */

/**
 * Formats we will write. Intentionally the extensions the *viewer* can resolve
 * (`workspace-image-source.ts`), because an image we write but cannot render is
 * a broken link that we created ourselves.
 *
 * The MIME type is what a paste gives us - a clipboard image has no filename at
 * all - so the table is keyed on it rather than on an extension.
 */
const IMAGE_EXTENSIONS_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
};

/**
 * The folder images land in, beside the document rather than at the workspace
 * root. A single shared root folder would collect every document's images into
 * one bucket and make them impossible to move with the document that uses them.
 */
const ASSET_DIRECTORY = "assets";

/** Clipboard images have no name; this is what they get instead. */
const PASTED_IMAGE_STEM = "pasted-image";

/**
 * Characters removed from a dropped file's name: illegal on Windows, or able to
 * end a markdown link target early. Whitespace is deliberately absent - it
 * becomes a hyphen instead, which keeps the word boundaries the name carries.
 */
const UNSAFE_FILE_NAME_CHARACTERS = /["*:<>?|()]/g;

export interface DroppedImage {
  /**
   * The file's own name when the drop carried one. Empty for a clipboard paste,
   * which is the common case: a screenshot has a MIME type and no name.
   */
  name: string;
  mimeType: string;
}

export interface ImageAssetTarget {
  /** Workspace-relative path to write, `/`-separated. */
  path: string;
}

/** The extension for an image MIME type, or null when it is not one we write. */
export function imageExtensionForMimeType(mimeType: string): string | null {
  // Clipboard and drop MIME types can carry parameters (`image/png; charset=…`)
  // and arrive in any case.
  const bare = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return IMAGE_EXTENSIONS_BY_MIME_TYPE[bare] ?? null;
}

/**
 * A dropped file's own name reduced to something safe to write.
 *
 * Path separators are dropped rather than escaped, so a name carrying `../../`
 * cannot climb anywhere: the result is always a single path segment. The daemon
 * contains the path again on its side - this is the client half of the same
 * rule the workspace image resolver states.
 */
export function sanitizeImageFileName(name: string): string {
  const lastSeparator = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const base = lastSeparator < 0 ? name : name.slice(lastSeparator + 1);
  const cleaned = base
    .replace(UNSAFE_FILE_NAME_CHARACTERS, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A name that was nothing but separators and punctuation, or one of the two
  // relative-directory names, leaves nothing usable behind.
  return cleaned === "." || cleaned === ".." ? "" : cleaned;
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, "0");
}

/**
 * `pasted-image-20260802-163055`. A timestamp rather than a counter because
 * nothing here can see the directory: the name has to be plausibly unique
 * before anyone asks the daemon whether it is.
 */
function timestampStem(now: Date): string {
  const date = `${now.getFullYear()}${twoDigits(now.getMonth() + 1)}${twoDigits(now.getDate())}`;
  const time = `${twoDigits(now.getHours())}${twoDigits(now.getMinutes())}${twoDigits(now.getSeconds())}`;
  return `${PASTED_IMAGE_STEM}-${date}-${time}`;
}

/**
 * Split a file name into stem and extension. The extension is kept verbatim
 * from the name when there is one, so `logo.svg` does not become `logo.png`
 * because the drop reported a MIME type we mapped differently.
 */
function splitFileName(fileName: string): { stem: string; extension: string } {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return { stem: fileName, extension: "" };
  }
  return { stem: fileName.slice(0, lastDot), extension: fileName.slice(lastDot + 1) };
}

/**
 * Where a dropped image goes and what gets typed for it, or null when it is not
 * an image we are willing to write.
 *
 * `index` disambiguates several images dropped in one gesture, which would
 * otherwise all take the same timestamp. It is not a collision check: the
 * daemon refuses to clobber and the caller retries with
 * {@link suffixImageAssetPath}, because only the daemon can see what is
 * already on disk.
 *
 * Deliberately returns the path ALONE, with no ready-made `![](...)`. The name
 * asked for here is not necessarily the name that ends up free, so the link has
 * to be built from the write's answer through {@link buildImageInsert}. A
 * pre-built link on this object would be the wrong one exactly when a collision
 * happened, which is the case nobody tests by hand.
 */
export function buildImageAssetTarget(input: {
  /** The document being edited, workspace-relative. */
  documentPath: string;
  image: DroppedImage;
  now: Date;
  /** 0 for the first image of a drop. */
  index: number;
}): ImageAssetTarget | null {
  const extensionFromMimeType = imageExtensionForMimeType(input.image.mimeType);
  if (!extensionFromMimeType) {
    return null;
  }

  const sanitized = sanitizeImageFileName(input.image.name);
  const named = sanitized ? splitFileName(sanitized) : null;
  const stem = named?.stem || timestampStem(input.now);
  const extension = named?.extension || extensionFromMimeType;
  const suffix = input.index > 0 ? `-${input.index + 1}` : "";
  const fileName = `${stem}${suffix}.${extension}`;

  const documentDirectory = input.documentPath.slice(0, input.documentPath.lastIndexOf("/") + 1);
  return { path: `${documentDirectory}${ASSET_DIRECTORY}/${fileName}` };
}

/** The `![](...)` for an image already written at a workspace-relative path. */
export function buildImageInsert(documentPath: string, imagePath: string): string {
  return `![](${encodeLinkPath(relativeLinkPath(documentPath, imagePath))})`;
}

/**
 * The next name to try when the daemon reports the target is taken: `x.png` ->
 * `x-2.png` -> `x-3.png`.
 *
 * Retrying is the client's job because `fs.file.write_binary` deliberately has
 * no overwrite-on-conflict mode - a drop must never destroy a file that is
 * already there, and only the daemon knows one is.
 */
export function suffixImageAssetPath(path: string, attempt: number): string {
  const lastSlash = path.lastIndexOf("/");
  const directory = path.slice(0, lastSlash + 1);
  const { stem, extension } = splitFileName(path.slice(lastSlash + 1));
  // Strip a suffix this function already added, so the third attempt is `-3`
  // rather than `-2-3`.
  const base = stem.replace(/-\d+$/, "");
  const name = extension ? `${base}-${attempt}.${extension}` : `${base}-${attempt}`;
  return `${directory}${name}`;
}
