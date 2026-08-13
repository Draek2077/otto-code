import fs from "node:fs";

import type { ModelMetadata } from "./types.js";

/**
 * Minimal GGUF metadata reader.
 *
 * We only need the header key/values that govern context length, attention
 * geometry and rope scaling - never the tensor data - so we read a bounded
 * prefix of the file rather than mapping gigabytes.
 */

export const TYPE = {
  UINT8: 0,
  INT8: 1,
  UINT16: 2,
  INT16: 3,
  UINT32: 4,
  INT32: 5,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
  INT64: 11,
  FLOAT64: 12,
};

const FIXED_WIDTH: Record<number, number | undefined> = {
  [TYPE.UINT8]: 1,
  [TYPE.INT8]: 1,
  [TYPE.UINT16]: 2,
  [TYPE.INT16]: 2,
  [TYPE.UINT32]: 4,
  [TYPE.INT32]: 4,
  [TYPE.FLOAT32]: 4,
  [TYPE.BOOL]: 1,
  [TYPE.UINT64]: 8,
  [TYPE.INT64]: 8,
  [TYPE.FLOAT64]: 8,
};

// Vocabularies can hold hundreds of thousands of strings; never materialize them.
const MAX_ARRAY_ITEMS = 64;

interface SkippedArray {
  skipped: true;
  count: number;
  elemType: number;
}

type GgufValue = string | number | boolean | GgufValue[] | SkippedArray;

class Cursor {
  buf: Buffer;
  pos: number;

  constructor(buffer: Buffer) {
    this.buf = buffer;
    this.pos = 0;
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  need(bytes: number): void {
    if (this.remaining < bytes) {
      const err = new Error("GGUF header extends beyond the bytes read") as Error & {
        code?: string;
      };
      err.code = "GGUF_NEED_MORE";
      throw err;
    }
  }

  take(bytes: number): Buffer {
    this.need(bytes);
    const slice = this.buf.subarray(this.pos, this.pos + bytes);
    this.pos += bytes;
    return slice;
  }

  scalar(type: number): number | boolean {
    const width = FIXED_WIDTH[type];
    if (width === undefined) throw new Error(`unsupported GGUF scalar type ${type}`);
    this.need(width);
    const { buf, pos } = this;
    let value: number | boolean;
    switch (type) {
      case TYPE.UINT8:
        value = buf.readUInt8(pos);
        break;
      case TYPE.INT8:
        value = buf.readInt8(pos);
        break;
      case TYPE.UINT16:
        value = buf.readUInt16LE(pos);
        break;
      case TYPE.INT16:
        value = buf.readInt16LE(pos);
        break;
      case TYPE.UINT32:
        value = buf.readUInt32LE(pos);
        break;
      case TYPE.INT32:
        value = buf.readInt32LE(pos);
        break;
      case TYPE.FLOAT32:
        value = buf.readFloatLE(pos);
        break;
      case TYPE.BOOL:
        value = buf.readUInt8(pos) !== 0;
        break;
      case TYPE.FLOAT64:
        value = buf.readDoubleLE(pos);
        break;
      case TYPE.UINT64:
        value = Number(buf.readBigUInt64LE(pos));
        break;
      case TYPE.INT64:
        value = Number(buf.readBigInt64LE(pos));
        break;
      default:
        throw new Error(`unsupported GGUF scalar type ${type}`);
    }
    this.pos += width;
    return value;
  }

  string(): string {
    const length = this.scalar(TYPE.UINT64) as number;
    return this.take(length).toString("utf8");
  }

  value(type: number): GgufValue {
    if (type === TYPE.STRING) return this.string();
    if (type !== TYPE.ARRAY) return this.scalar(type);

    const elemType = this.scalar(TYPE.UINT32) as number;
    const count = this.scalar(TYPE.UINT64) as number;

    if (count > MAX_ARRAY_ITEMS) {
      // Skip the payload without decoding it.
      if (elemType === TYPE.STRING) {
        for (let i = 0; i < count; i += 1) this.string();
      } else {
        this.take((FIXED_WIDTH[elemType] as number) * count);
      }
      return { skipped: true, count, elemType };
    }

    const items: GgufValue[] = [];
    for (let i = 0; i < count; i += 1) items.push(this.value(elemType));
    return items;
  }
}

interface Prefix {
  buffer: Buffer;
  fileSize: number;
}

/** Read the first `bytes` of a file (or the whole file if smaller). */
function readPrefix(file: string, bytes: number): Prefix {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(bytes, size);
    const buffer = Buffer.allocUnsafe(length);
    fs.readSync(fd, buffer, 0, length, 0);
    return { buffer, fileSize: size };
  } finally {
    fs.closeSync(fd);
  }
}

interface GgufHeader {
  version: number;
  tensorCount: number;
  fileSize: number;
  meta: ModelMetadata;
}

export function readMetadata(file: string): GgufHeader {
  // Grow the window if a big tokenizer pushes the header past our first read.
  let windowBytes = 8 * 1024 * 1024;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { buffer, fileSize } = readPrefix(file, windowBytes);
    const cursor = new Cursor(buffer);
    try {
      const magic = cursor.take(4).toString("ascii");
      if (magic !== "GGUF") throw new Error(`${file} is not a GGUF file`);

      const version = cursor.scalar(TYPE.UINT32) as number;
      const tensorCount = cursor.scalar(TYPE.UINT64) as number;
      const kvCount = cursor.scalar(TYPE.UINT64) as number;

      const meta: ModelMetadata = {};
      for (let i = 0; i < kvCount; i += 1) {
        const key = cursor.string();
        const type = cursor.scalar(TYPE.UINT32) as number;
        meta[key] = cursor.value(type);
      }
      return { version, tensorCount, fileSize, meta };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== "GGUF_NEED_MORE" || windowBytes >= fileSize) throw error;
      windowBytes = Math.min(windowBytes * 4, fileSize);
    }
  }
  throw new Error(`could not read GGUF header from ${file}`);
}

interface GgufSummary {
  file: string;
  fileSize: number;
  ggufVersion: number;
  tensorCount: number;
  arch: string;
  name: string | null;
  basename: string | null;
  sizeLabel: string | null;
  fileType: number | null;
  contextLength: number | null;
  blockCount: number | null;
  embeddingLength: number | null;
  headCount: number | null;
  headCountKv: number | null;
  keyLength: number | null;
  valueLength: number | null;
  ropeFreqBase: number | null;
  ropeScalingType: string | null;
  ropeScalingFactor: number | null;
  expertCount: number | null;
  eosTokenId: number | null;
  isProjector: boolean;
  /** Chat template exposes a thinking/reasoning channel. */
  reasoning: boolean;
}

/**
 * Pull out the fields that matter for hosting decisions.
 */
export function summarize(file: string): GgufSummary {
  const { version, tensorCount, fileSize, meta } = readMetadata(file);
  const arch = (meta["general.architecture"] as string) || "unknown";
  const get = (suffix: string): unknown => meta[`${arch}.${suffix}`];

  const heads = get("attention.head_count");
  const embedding = get("embedding_length");
  let keyLength: unknown = get("attention.key_length");
  let valueLength: unknown = get("attention.value_length");
  if (keyLength === undefined && typeof embedding === "number" && typeof heads === "number") {
    keyLength = embedding / heads;
  }
  if (valueLength === undefined) valueLength = keyLength;

  let kvHeads: unknown = get("attention.head_count_kv");
  if (Array.isArray(kvHeads)) kvHeads = Math.max(...(kvHeads as number[]));

  // A reasoning model advertises its thinking channel in the chat template: a
  // `<think>` block, a `reasoning_content` field, or an `enable_thinking`
  // toggle. Detecting it here (rather than from the filename or the catalog)
  // means any local model is flagged, matching LM Studio's green-brain marker.
  const chatTemplate =
    typeof meta["tokenizer.chat_template"] === "string"
      ? (meta["tokenizer.chat_template"] as string)
      : "";
  const reasoning = /<think>|<\/think>|reasoning_content|enable_thinking/i.test(chatTemplate);

  return {
    file,
    fileSize,
    ggufVersion: version,
    tensorCount,
    arch,
    name: (meta["general.name"] as string | null) || null,
    basename: (meta["general.basename"] as string | null) || null,
    sizeLabel: (meta["general.size_label"] as string | null) || null,
    fileType: (meta["general.file_type"] ?? null) as number | null,
    contextLength: (get("context_length") ?? null) as number | null,
    blockCount: (get("block_count") ?? null) as number | null,
    embeddingLength: (embedding ?? null) as number | null,
    headCount: (heads ?? null) as number | null,
    headCountKv: typeof kvHeads === "number" ? kvHeads : null,
    keyLength: typeof keyLength === "number" ? keyLength : null,
    valueLength: typeof valueLength === "number" ? valueLength : null,
    ropeFreqBase: (get("rope.freq_base") ?? null) as number | null,
    ropeScalingType: (get("rope.scaling.type") ?? null) as string | null,
    ropeScalingFactor: (get("rope.scaling.factor") ?? null) as number | null,
    expertCount: (get("expert_count") ?? null) as number | null,
    eosTokenId: (meta["tokenizer.ggml.eos_token_id"] ?? null) as number | null,
    isProjector: Boolean(meta["clip.has_vision_encoder"] || arch === "clip"),
    reasoning,
  };
}
