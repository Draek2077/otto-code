import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { estimateAssistantMessageHeightFromCache as estimateAssistantImageMessageHeightFromCache } from "@/utils/assistant-image-metadata";
import { splitMarkdownBlocks } from "@/utils/split-markdown-blocks";

const ASSISTANT_MARKDOWN_BLOCK_HEIGHT_CACHE_LIMIT = 1000;
const ASSISTANT_MARKDOWN_BLOCK_FALLBACK_ESTIMATE_WIDTH = MAX_CONTENT_WIDTH - 16;
const ASSISTANT_MESSAGE_VERTICAL_PADDING = 24;

/**
 * The width the cache is currently keyed at.
 *
 * Reads and writes have to agree on this or the cache cannot hit, and until now they did
 * not: every measurement was stored under the block's real rendered width while every
 * lookup asked for `MAX_CONTENT_WIDTH - 16`. Unless the chat column happened to be exactly
 * that wide, every write landed on a key nothing ever read, the estimator always returned
 * null, and the per-block measurement that produced it was pure cost.
 *
 * One module-level value rather than a parameter because the virtualizer's `estimateSize`
 * has no width to hand, and there is only ever one chat column width to know: every mounted
 * message measures at the same width, so the last measurement is the current answer.
 */
let currentEstimateWidth = ASSISTANT_MARKDOWN_BLOCK_FALLBACK_ESTIMATE_WIDTH;

interface MarkdownBlockHeightInput {
  block: string;
  width: number;
}

const assistantMarkdownBlockHeightCache = new Map<string, number>();

function touchCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size <= limit) {
    return;
  }
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
}

function hashMarkdownBlock(block: string): string {
  let hash = 2166136261;
  for (let index = 0; index < block.length; index += 1) {
    hash ^= block.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${block.length}:${(hash >>> 0).toString(36)}`;
}

function normalizeMarkdownBlockWidth(width: number): number | null {
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }
  return Math.round(width);
}

function createMarkdownBlockHeightKey(input: MarkdownBlockHeightInput): string | null {
  const normalizedWidth = normalizeMarkdownBlockWidth(input.width);
  if (normalizedWidth === null) {
    return null;
  }
  if (input.block.length === 0) {
    return null;
  }
  return `${normalizedWidth}:${hashMarkdownBlock(input.block)}`;
}

export function setAssistantMarkdownBlockHeight(input: {
  block: string;
  width: number;
  height: number;
}): number | null {
  if (!Number.isFinite(input.height) || input.height <= 0) {
    return null;
  }
  const key = createMarkdownBlockHeightKey({
    block: input.block,
    width: input.width,
  });
  if (!key) {
    return null;
  }
  const height = Math.ceil(input.height);
  const measuredWidth = normalizeMarkdownBlockWidth(input.width);
  if (measuredWidth !== null) {
    currentEstimateWidth = measuredWidth;
  }
  touchCacheEntry(
    assistantMarkdownBlockHeightCache,
    key,
    height,
    ASSISTANT_MARKDOWN_BLOCK_HEIGHT_CACHE_LIMIT,
  );
  return height;
}

function estimateAssistantMarkdownBlockHeightFromCache(markdown: string): number | null {
  const blocks = splitMarkdownBlocks(markdown);
  if (blocks.length === 0) {
    return null;
  }

  let blockHeight = 0;
  for (const block of blocks) {
    const key = createMarkdownBlockHeightKey({
      block,
      width: currentEstimateWidth,
    });
    const cachedHeight = key ? assistantMarkdownBlockHeightCache.get(key) : undefined;
    if (cachedHeight === undefined) {
      return null;
    }
    blockHeight += cachedHeight;
  }

  // Measured block heights include each block's own trailing markdown margin
  // (child margins contribute to the measuring View's layout height), so no
  // per-block gap is added here - the block containers render margin-less.
  return ASSISTANT_MESSAGE_VERTICAL_PADDING + blockHeight;
}

export function estimateAssistantMessageHeightFromCache(markdown: string): number | null {
  return (
    estimateAssistantMarkdownBlockHeightFromCache(markdown) ??
    estimateAssistantImageMessageHeightFromCache(markdown)
  );
}

/**
 * Whether this block's height is already known at the width it is rendering at. Lets a
 * mounted block drop its layout observer instead of re-reporting a number the cache
 * already holds, which is the difference between measuring once and measuring on every
 * scroll-driven layout pass for every mounted message.
 */
export function hasAssistantMarkdownBlockHeight(input: { block: string; width: number }): boolean {
  const key = createMarkdownBlockHeightKey(input);
  return key !== null && assistantMarkdownBlockHeightCache.has(key);
}

export function clearAssistantMessageHeightEstimateCache(): void {
  assistantMarkdownBlockHeightCache.clear();
  currentEstimateWidth = ASSISTANT_MARKDOWN_BLOCK_FALLBACK_ESTIMATE_WIDTH;
}
