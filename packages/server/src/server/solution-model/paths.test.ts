import { describe, expect, it } from "vitest";
import { fromWirePath, isInsideWorkspace, toPosix, toPosixAbsolute, toWirePath } from "./paths.js";

const isWindows = process.platform === "win32";
const root = isWindows ? "C:/repo" : "/repo";
const outside = isWindows ? "C:/elsewhere" : "/elsewhere";

describe("solution-model path normalisation", () => {
  it("forward-slashes what the solution libraries hand back", () => {
    // The library returns platform separators even for a .slnx that stores forward slashes, so
    // this is the property that makes the wire shape identical on every OS.
    expect(toPosix("src\\App\\App.csproj")).toBe("src/App/App.csproj");
    expect(toPosixAbsolute(`${root}\\src\\App`)).toBe(`${root}/src/App`);
  });

  it("drops a trailing separator but keeps a drive root", () => {
    expect(toPosix("/repo/src/")).toBe("/repo/src");
    expect(toPosix("C:/")).toBe("C:/");
  });

  it("reports a file inside the workspace as workspace-relative", () => {
    const wire = toWirePath(root, `${root}/src/App/App.csproj`);
    expect(wire).toEqual({ path: "src/App/App.csproj", outsideWorkspace: false });
  });

  it("calls the root itself `.`, matching what the explorer calls it", () => {
    expect(toWirePath(root, root)).toEqual({ path: ".", outsideWorkspace: false });
  });

  /**
   * The out-of-workspace policy, made legible on the wire. Shown and opened like any other file —
   * the solution names it, so this is following a declaration, not free browsing — but flagged, so
   * nothing downstream has to infer it by inspecting the string.
   */
  it("keeps an out-of-workspace project absolute and flags it", () => {
    const wire = toWirePath(root, `${outside}/Shared/Shared.csproj`);
    expect(wire.outsideWorkspace).toBe(true);
    expect(wire.path).toBe(`${outside}/Shared/Shared.csproj`);
  });

  it("does not mistake a sibling with a shared prefix for a child", () => {
    // `/repo-tools` starts with `/repo` as a string. Only a separator makes it containment.
    expect(isInsideWorkspace(root, `${root}-tools/x.csproj`)).toBe(false);
    expect(isInsideWorkspace(root, `${root}/tools/x.csproj`)).toBe(true);
  });

  it.runIf(isWindows)("folds case on Windows-shaped paths", () => {
    // Same file, two spellings. Comparing raw strings gets this wrong.
    expect(isInsideWorkspace("C:/Repo", "c:/repo/src/App.csproj")).toBe(true);
  });

  it.runIf(!isWindows)("keeps case on POSIX paths, where two spellings are two files", () => {
    expect(isInsideWorkspace("/repo", "/REPO/src/App.csproj")).toBe(false);
  });

  it("round-trips a relative wire path back to absolute", () => {
    expect(fromWirePath(root, "src/App/App.csproj")).toBe(`${root}/src/App/App.csproj`);
  });

  it("honours an absolute wire path as-is, which is the out-of-workspace case", () => {
    expect(fromWirePath(root, `${outside}/Shared/Shared.csproj`)).toBe(
      `${outside}/Shared/Shared.csproj`,
    );
  });
});
