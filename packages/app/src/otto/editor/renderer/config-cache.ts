import type { z } from "zod";
import type { NativeEditorConfig } from "./bridge";

type Configuration = Omit<z.infer<typeof NativeEditorConfig>, "diagnostics"> & {
  diagnostics: readonly z.infer<typeof NativeEditorConfig>["diagnostics"][number][];
};
/** Selection/leader presentation changes must not serialize the entire source
 * back through the native bridge. Text and diagnostics retain their identity. */
export class NativeEditorConfigurationCache {
  private previous: Configuration | null = null;
  accept(next: Configuration): boolean {
    const before = this.previous;
    if (
      before &&
      Object.entries(next).every(([key, value]) => Object.is(Reflect.get(before, key), value))
    )
      return false;
    this.previous = next;
    return true;
  }
}
