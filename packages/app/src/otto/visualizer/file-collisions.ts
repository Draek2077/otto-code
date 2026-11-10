export function canonicalVisualizerPath(path: string, root: string): string | null {
  let value = path.trim().replace(/\\/g, "/");
  if (!value || value.length > 4096 || value.includes("\0")) return null;
  if (!/^(?:[A-Za-z]:\/|\/)/u.test(value)) {
    const ownerRoot = root.trim().replace(/\\/g, "/").replace(/\/+$/u, "");
    if (!/^(?:[A-Za-z]:\/|\/)/u.test(ownerRoot)) return null;
    value = `${ownerRoot}/${value}`;
  }
  if (!/^(?:[A-Za-z]:\/|\/)/u.test(value)) return null;
  const drive = /^[A-Za-z]:\//u.test(value) ? value.slice(0, 2).toLowerCase() : "";
  const segments: string[] = [];
  for (const part of (drive ? value.slice(2) : value).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  const normalized = `${drive}/${segments.join("/")}`;
  return drive ? normalized.toLowerCase() : normalized;
}
export interface VisualizerFileTouch {
  id: string;
  sessionId: string;
  agent: string;
  path: string;
  mode: "read" | "write";
  at: number;
}
export class VisualizerCollisions {
  private readonly files = new Map<string, VisualizerFileTouch[]>();
  add(touch: VisualizerFileTouch) {
    const previous = this.files.get(touch.path) ?? [];
    const collisions = previous.filter(
      (item) =>
        item.agent !== touch.agent &&
        Math.abs(touch.at - item.at) <= 90_000 &&
        (touch.mode === "write" || item.mode === "write"),
    );
    this.files.delete(touch.path);
    this.files.set(touch.path, [
      ...previous.filter((item) => item.id !== touch.id).slice(-23),
      touch,
    ]);
    if (this.files.size > 300) {
      const oldest = this.files.keys().next().value;
      if (oldest) this.files.delete(oldest);
    }
    return collisions;
  }
}
