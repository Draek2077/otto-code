export class PendingOpenProjectStore {
  private readonly pendingPathByWebContentsId = new Map<number, string>();
  private readonly pendingTargetByWebContentsId = new Map<
    number,
    { kind: "directory-shell" | "file"; path: string }
  >();

  set(webContentsId: number, projectPath: string | null | undefined): void {
    const normalizedPath = this.normalizeProjectPath(projectPath);
    if (!normalizedPath) {
      this.pendingPathByWebContentsId.delete(webContentsId);
      return;
    }

    this.pendingPathByWebContentsId.set(webContentsId, normalizedPath);
  }

  take(webContentsId: number): string | null {
    const projectPath = this.pendingPathByWebContentsId.get(webContentsId) ?? null;
    this.pendingPathByWebContentsId.delete(webContentsId);
    return projectPath;
  }

  setTarget(
    webContentsId: number,
    target: { kind: "directory-shell" | "file"; path: string } | null | undefined,
  ): void {
    const normalizedPath = this.normalizeProjectPath(target?.path);
    if (!target || !normalizedPath) {
      this.pendingTargetByWebContentsId.delete(webContentsId);
      return;
    }
    this.pendingTargetByWebContentsId.set(webContentsId, {
      kind: target.kind,
      path: normalizedPath,
    });
  }

  takeTarget(webContentsId: number): { kind: "directory-shell" | "file"; path: string } | null {
    const target = this.pendingTargetByWebContentsId.get(webContentsId) ?? null;
    this.pendingTargetByWebContentsId.delete(webContentsId);
    return target;
  }

  delete(webContentsId: number): void {
    this.pendingPathByWebContentsId.delete(webContentsId);
    this.pendingTargetByWebContentsId.delete(webContentsId);
  }

  private normalizeProjectPath(projectPath: string | null | undefined): string | null {
    if (typeof projectPath !== "string") {
      return null;
    }

    const trimmedPath = projectPath.trim();
    return trimmedPath ? trimmedPath : null;
  }
}
