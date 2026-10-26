import type { ProjectBinding, waitBoardChanges } from "@getpaseo/plugin/otto/kanban";
import type { z } from "zod";

/** A feed cursor only invalidates reads. It never replaces an opened action's
 * captured board/card revision or carries canonical board data into a cache. */
export function observeBoard(input: {
  binding: ProjectBinding;
  leaseId: string;
  wait(
    request: z.infer<typeof waitBoardChanges.input>,
  ): Promise<z.infer<typeof waitBoardChanges.output>>;
  release(request: { leaseId: string }): Promise<unknown>;
  changed(): void;
  failed(): void;
}) {
  let active = true;
  const release = () => {
    void input.release({ leaseId: input.leaseId }).catch(() => undefined);
  };
  async function read() {
    let cursor: string | null = null;
    try {
      for (;;) {
        if (!active) return;
        const response = await input.wait({
          binding: input.binding,
          leaseId: input.leaseId,
          cursor,
        });
        if (!active) return;
        if (!response.ok) {
          input.failed();
          return;
        }
        if (cursor !== response.value.cursor) {
          cursor = response.value.cursor;
          // The initial read also closes the mount/read -> retain race.
          input.changed();
        }
      }
    } catch {
      if (active) input.failed();
    } finally {
      // A release can overtake its in-flight initial retain. Release the same
      // identity again after settlement; daemon release is idempotent.
      release();
    }
  }
  void read();
  return () => {
    active = false;
    release();
  };
}
