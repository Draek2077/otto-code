interface ReplacementPorts {
  windows: boolean;
  read(file: string): Promise<string | null>;
  rename(source: string, destination: string): Promise<void>;
  wait(ms: number): Promise<void>;
}

/** A failed Windows replacement can be a transient sharing denial. This is
 * recovery of a proven uncommitted syscall, never replay of a generation or an
 * unknown write. Both files must still contain their captured bytes. */
export async function replaceStagedArtifact(
  source: string,
  destination: string,
  text: string,
  ports: ReplacementPorts,
): Promise<void> {
  const previous = ports.windows ? await ports.read(destination) : null;
  for (let attempt = 0; ; attempt++) {
    const failure = await ports.rename(source, destination).then(
      () => null,
      (error: unknown) => ({ error }),
    );
    if (!failure) return;
    if (
      !ports.windows ||
      attempt === 3 ||
      !(failure.error instanceof Error) ||
      !("code" in failure.error) ||
      failure.error.code !== "EPERM"
    )
      throw failure.error;
    await ports.wait([10, 25, 50][attempt]!);
    // Missing staging bytes, a changed destination, links or unreadable files
    // leave the original failure intact. No target unlink or ACL changes.
    // Sequential reads also finish their handle cleanup before a rejected read
    // can return to publish's staging cleanup.
    const unchanged = await ports
      .read(source)
      .then(async (staged) => {
        if (staged !== text) return false;
        return (await ports.read(destination)) === previous;
      })
      .catch(() => false);
    if (!unchanged) throw failure.error;
  }
}
