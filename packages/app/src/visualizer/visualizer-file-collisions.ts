/** Detect nearby file touches by distinct agents without tying the Visualizer
 * to any provider's transcript format. Paths are resolved by the Otto adapter
 * before they reach this index; display paths remain separate. */
export interface FileTouch {
  callId: string;
  sessionId: string;
  agent: string;
  path: string;
  displayPath: string;
  mode: "read" | "write";
  atMs: number;
}

export interface FileCollision {
  id: string;
  path: string;
  atMs: number;
  left: FileTouch;
  right: FileTouch;
}

const COLLISION_WINDOW_MS = 90_000;
const MAX_PATHS = 300;
const MAX_TOUCHES_PER_PATH = 24;
const MAX_SEEN_CALLS = 10_000;

export function canonicalFileIdentity(path: string, workspaceRoot?: string): string | null {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized) return null;
  let absolute: string | null = null;
  if (/^(?:[A-Za-z]:\/|\/)/.test(normalized)) {
    absolute = normalized;
  } else if (workspaceRoot) {
    absolute = `${workspaceRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "")}/${normalized}`;
  }
  if (!absolute) return null;
  const drive = /^[A-Za-z]:\//.test(absolute) ? absolute.slice(0, 2).toLowerCase() : "";
  const segments = (drive ? absolute.slice(2) : absolute).split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  const result = `${drive}/${resolved.join("/")}`;
  return drive ? result.toLowerCase() : result;
}

export class FileCollisionIndex {
  private readonly touches = new Map<string, FileTouch[]>();
  private readonly seen = new Set<string>();

  add(touch: FileTouch): FileCollision[] {
    if (!Number.isFinite(touch.atMs)) return [];
    const identity = `${touch.sessionId}:${touch.agent}:${touch.callId}`;
    if (this.seen.has(identity)) return [];
    this.seen.add(identity);
    if (this.seen.size > MAX_SEEN_CALLS) this.seen.delete(this.seen.values().next().value!);

    const recent = this.touches.get(touch.path) ?? [];
    const collisions = recent
      .filter(
        (previous) =>
          previous.agent !== touch.agent &&
          Math.abs(touch.atMs - previous.atMs) <= COLLISION_WINDOW_MS &&
          (previous.mode === "write" || touch.mode === "write"),
      )
      .map((previous) => ({
        id: [
          `${previous.sessionId}:${previous.agent}:${previous.callId}`,
          `${touch.sessionId}:${touch.agent}:${touch.callId}`,
        ]
          .sort()
          .join("|"),
        path: touch.displayPath,
        atMs: Math.max(previous.atMs, touch.atMs),
        left: previous,
        right: touch,
      }));
    this.touches.delete(touch.path);
    this.touches.set(touch.path, [...recent.slice(-(MAX_TOUCHES_PER_PATH - 1)), touch]);
    if (this.touches.size > MAX_PATHS) this.touches.delete(this.touches.keys().next().value!);
    return collisions;
  }
}
