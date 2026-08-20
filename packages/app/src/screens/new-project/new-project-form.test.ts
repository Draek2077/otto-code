import { describe, expect, it } from "vitest";
import {
  buildScaffoldGitRequest,
  createNewProjectFormState,
  deriveFolderNameFromCloneUrl,
  detectPathSeparator,
  findDuplicateProjectPath,
  getNewProjectBlocker,
  previewProjectPath,
  shouldShowDuplicateProjectPath,
  resolveRemoteRepositoryName,
  type NewProjectCapabilities,
  type NewProjectFormState,
} from "./new-project-form";

const CAPABLE: NewProjectCapabilities = {
  canScaffold: true,
  remoteCapableProviders: ["github", "bitbucket-cloud"],
  providersRequiringOwner: ["bitbucket-cloud"],
};

function form(overrides: Partial<NewProjectFormState>): NewProjectFormState {
  return { ...createNewProjectFormState(), ...overrides };
}

describe("getNewProjectBlocker", () => {
  it("needs a directory in every mode", () => {
    expect(getNewProjectBlocker(form({ mode: "open" }), CAPABLE)).toBe("directory_required");
    expect(getNewProjectBlocker(form({ mode: "create" }), CAPABLE)).toBe("directory_required");
    expect(getNewProjectBlocker(form({ mode: "clone" }), CAPABLE)).toBe("directory_required");
  });

  it("accepts an existing folder with nothing else filled in", () => {
    expect(getNewProjectBlocker(form({ mode: "open", directory: "/src" }), CAPABLE)).toBeNull();
  });

  it("blocks every scaffolding mode when the host cannot scaffold", () => {
    const incapable: NewProjectCapabilities = { ...CAPABLE, canScaffold: false };
    expect(getNewProjectBlocker(form({ mode: "create", directory: "/src" }), incapable)).toBe(
      "scaffold_unsupported",
    );
    // ...but never the open path, which works on every daemon.
    expect(getNewProjectBlocker(form({ mode: "open", directory: "/src" }), incapable)).toBeNull();
  });

  it("needs a folder name to create one", () => {
    expect(getNewProjectBlocker(form({ mode: "create", directory: "/src" }), CAPABLE)).toBe(
      "folder_name_required",
    );
    expect(
      getNewProjectBlocker(
        form({ mode: "create", directory: "/src", folderName: "thing", gitSetup: "init" }),
        CAPABLE,
      ),
    ).toBeNull();
  });

  it("needs a URL to clone, but no folder name", () => {
    expect(getNewProjectBlocker(form({ mode: "clone", directory: "/src" }), CAPABLE)).toBe(
      "clone_url_required",
    );
    expect(
      getNewProjectBlocker(
        form({ mode: "clone", directory: "/src", cloneUrl: "https://host/a/b.git" }),
        CAPABLE,
      ),
    ).toBeNull();
  });

  describe("remote creation", () => {
    const base = form({
      mode: "create",
      directory: "/src",
      folderName: "thing",
      gitSetup: "remote",
    });

    it("requires a provider that can actually create repositories", () => {
      expect(getNewProjectBlocker(base, CAPABLE)).toBe("remote_provider_required");
      expect(getNewProjectBlocker({ ...base, remoteProvider: "gitlab" }, CAPABLE)).toBe(
        "remote_provider_required",
      );
    });

    it("falls back to the folder name for the repository name", () => {
      expect(getNewProjectBlocker({ ...base, remoteProvider: "github" }, CAPABLE)).toBeNull();
    });

    it("requires an owner only for providers that cannot infer one", () => {
      expect(getNewProjectBlocker({ ...base, remoteProvider: "bitbucket-cloud" }, CAPABLE)).toBe(
        "remote_owner_required",
      );
      expect(
        getNewProjectBlocker(
          { ...base, remoteProvider: "bitbucket-cloud", remoteOwner: "team" },
          CAPABLE,
        ),
      ).toBeNull();
    });

    it("reports a missing name when neither the folder nor the field has one", () => {
      expect(
        getNewProjectBlocker({ ...base, folderName: "  ", remoteProvider: "github" }, CAPABLE),
      ).toBe("folder_name_required");
    });
  });
});

describe("resolveRemoteRepositoryName", () => {
  it("defaults to the folder name and yields to an explicit override", () => {
    expect(resolveRemoteRepositoryName(form({ folderName: "thing" }))).toBe("thing");
    expect(resolveRemoteRepositoryName(form({ folderName: "thing", remoteName: "other" }))).toBe(
      "other",
    );
  });
});

describe("buildScaffoldGitRequest", () => {
  it("returns null for the open path and for an unsubmittable form", () => {
    expect(buildScaffoldGitRequest(form({ mode: "open", directory: "/src" }), CAPABLE)).toBeNull();
    expect(buildScaffoldGitRequest(form({ mode: "create", directory: "" }), CAPABLE)).toBeNull();
  });

  it("builds a plain-folder request", () => {
    expect(
      buildScaffoldGitRequest(
        form({ mode: "create", directory: "/src", folderName: "thing", gitSetup: "none" }),
        CAPABLE,
      ),
    ).toEqual({ kind: "none" });
  });

  it("builds an init request with the starter-file choices", () => {
    expect(
      buildScaffoldGitRequest(
        form({
          mode: "create",
          directory: "/src",
          folderName: "thing",
          gitSetup: "init",
          initialBranch: "trunk",
          addReadme: true,
          gitignoreTemplate: "node",
        }),
        CAPABLE,
      ),
    ).toEqual({
      kind: "init",
      initialBranch: "trunk",
      addReadme: true,
      gitignoreTemplate: "node",
      initialCommit: true,
    });
  });

  it("omits an empty branch so the daemon uses git's own default", () => {
    const request = buildScaffoldGitRequest(
      form({
        mode: "create",
        directory: "/src",
        folderName: "thing",
        gitSetup: "init",
        initialBranch: "   ",
      }),
      CAPABLE,
    );
    expect(request).toMatchObject({ kind: "init" });
    expect((request as { initialBranch?: string }).initialBranch).toBeUndefined();
  });

  it("builds a remote request, defaulting the name and nulling an empty owner", () => {
    expect(
      buildScaffoldGitRequest(
        form({
          mode: "create",
          directory: "/src",
          folderName: "thing",
          gitSetup: "remote",
          remoteProvider: "github",
          remoteVisibility: "public",
          remoteDescription: " a thing ",
        }),
        CAPABLE,
      ),
    ).toMatchObject({
      kind: "init",
      remote: {
        providerId: "github",
        owner: null,
        name: "thing",
        description: "a thing",
        visibility: "public",
      },
    });
  });

  it("builds a clone request", () => {
    expect(
      buildScaffoldGitRequest(
        form({ mode: "clone", directory: "/src", cloneUrl: " https://host/a/b.git " }),
        CAPABLE,
      ),
    ).toEqual({ kind: "clone", url: "https://host/a/b.git" });
  });
});

describe("previewProjectPath", () => {
  it("shows the directory itself when opening an existing folder", () => {
    expect(previewProjectPath(form({ mode: "open", directory: "/src/thing" }))).toBe("/src/thing");
  });

  it("joins the parent and the new folder without doubling the separator", () => {
    expect(
      previewProjectPath(form({ mode: "create", directory: "/src/", folderName: "thing" })),
    ).toBe("/src/thing");
    expect(
      previewProjectPath(form({ mode: "create", directory: "C:\\src\\", folderName: "thing" })),
    ).toBe("C:\\src\\thing");
  });

  it("joins with the separator the directory already uses, never a mixed path", () => {
    // The reported bug: a Windows parent joined with "/".
    expect(
      previewProjectPath(
        form({ mode: "create", directory: "C:\\Users\\phili\\Projects", folderName: "test-new" }),
      ),
    ).toBe("C:\\Users\\phili\\Projects\\test-new");
    // A Windows drive written with forward slashes keeps forward slashes.
    expect(
      previewProjectPath(form({ mode: "create", directory: "C:/src", folderName: "thing" })),
    ).toBe("C:/src/thing");
    expect(
      previewProjectPath(form({ mode: "create", directory: "/home/me", folderName: "thing" })),
    ).toBe("/home/me/thing");
  });

  it("previews the clone's derived folder before one is typed", () => {
    expect(
      previewProjectPath(
        form({ mode: "clone", directory: "/src", cloneUrl: "https://host/a/b.git" }),
      ),
    ).toBe("/src/b");
  });

  it("returns null while there is nothing to preview", () => {
    expect(previewProjectPath(form({ mode: "create", directory: "" }))).toBeNull();
    expect(previewProjectPath(form({ mode: "create", directory: "/src" }))).toBeNull();
  });
});

describe("detectPathSeparator", () => {
  it("copies the separator the directory already uses", () => {
    expect(detectPathSeparator("C:\\Users\\me")).toBe("\\");
    expect(detectPathSeparator("/home/me")).toBe("/");
    expect(detectPathSeparator("C:/src")).toBe("/");
  });

  it("treats a bare drive letter as Windows, since it has none to copy", () => {
    expect(detectPathSeparator("C:")).toBe("\\");
  });
});

describe("findDuplicateProjectPath", () => {
  const existing = ["/src/thing", "/src/other"];

  it("catches a folder that is already a project", () => {
    expect(
      findDuplicateProjectPath({ targetPath: "/src/thing", existingProjectPaths: existing }),
    ).toBe("/src/thing");
  });

  it("ignores separator and trailing-slash differences", () => {
    expect(
      findDuplicateProjectPath({ targetPath: "/src/thing/", existingProjectPaths: existing }),
    ).toBe("/src/thing");
    expect(
      findDuplicateProjectPath({
        targetPath: "C:\\src\\thing",
        existingProjectPaths: ["C:/src/thing"],
      }),
    ).toBe("C:/src/thing");
  });

  it("returns null for a path no project owns", () => {
    expect(
      findDuplicateProjectPath({ targetPath: "/src/fresh", existingProjectPaths: existing }),
    ).toBeNull();
  });

  it("returns null while there is no target yet", () => {
    expect(
      findDuplicateProjectPath({ targetPath: null, existingProjectPaths: existing }),
    ).toBeNull();
    expect(
      findDuplicateProjectPath({ targetPath: "   ", existingProjectPaths: existing }),
    ).toBeNull();
  });

  it("catches a create/clone target that lands on an existing project", () => {
    // previewProjectPath is what feeds this, so the create path is covered too.
    const target = previewProjectPath(
      form({ mode: "create", directory: "/src", folderName: "thing" }),
    );
    expect(findDuplicateProjectPath({ targetPath: target, existingProjectPaths: existing })).toBe(
      "/src/thing",
    );
  });
});

describe("shouldShowDuplicateProjectPath", () => {
  it("does not turn its own successful registration into a visible conflict", () => {
    expect(
      shouldShowDuplicateProjectPath({
        duplicateProjectPath: "/src/new-project",
        isSubmitting: true,
        hasSuccessfulSubmission: false,
      }),
    ).toBe(false);
    expect(
      shouldShowDuplicateProjectPath({
        duplicateProjectPath: "/src/new-project",
        isSubmitting: false,
        hasSuccessfulSubmission: false,
      }),
    ).toBe(true);
    expect(
      shouldShowDuplicateProjectPath({
        duplicateProjectPath: "/src/new-project",
        isSubmitting: false,
        hasSuccessfulSubmission: true,
      }),
    ).toBe(false);
  });
});

describe("deriveFolderNameFromCloneUrl", () => {
  it("matches the daemon's derivation", () => {
    expect(deriveFolderNameFromCloneUrl("https://github.com/otto/otto-code.git")).toBe("otto-code");
    expect(deriveFolderNameFromCloneUrl("git@github.com:otto/otto-code.git")).toBe("otto-code");
    expect(deriveFolderNameFromCloneUrl("")).toBe("");
  });
});
