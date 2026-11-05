import { describe, expect, it } from "vitest";
import {
  buildImageAssetTarget,
  buildImageInsert,
  imageExtensionForMimeType,
  sanitizeImageFileName,
  suffixImageAssetPath,
} from "./markdown-image-drop";

const NOW = new Date(2026, 7, 2, 16, 30, 55);

describe("imageExtensionForMimeType", () => {
  it("maps the formats the viewer can resolve", () => {
    expect(imageExtensionForMimeType("image/png")).toBe("png");
    expect(imageExtensionForMimeType("image/jpeg")).toBe("jpg");
    expect(imageExtensionForMimeType("image/svg+xml")).toBe("svg");
  });

  it("tolerates the parameters and casing a clipboard actually sends", () => {
    expect(imageExtensionForMimeType("IMAGE/PNG")).toBe("png");
    expect(imageExtensionForMimeType("image/png; charset=binary")).toBe("png");
  });

  it("declines anything that is not an image we write", () => {
    expect(imageExtensionForMimeType("application/pdf")).toBeNull();
    expect(imageExtensionForMimeType("text/plain")).toBeNull();
    expect(imageExtensionForMimeType("")).toBeNull();
  });
});

describe("sanitizeImageFileName", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeImageFileName("diagram.png")).toBe("diagram.png");
  });

  it("reduces a traversal attempt to its last segment", () => {
    expect(sanitizeImageFileName("../../../etc/passwd.png")).toBe("passwd.png");
    expect(sanitizeImageFileName("..\\..\\windows\\system32\\evil.png")).toBe("evil.png");
  });

  it("removes characters that would break the link target or the filesystem", () => {
    expect(sanitizeImageFileName("my screenshot (1).png")).toBe("my-screenshot-1.png");
    expect(sanitizeImageFileName('a"b|c?d*e.png')).toBe("abcde.png");
  });

  it("returns nothing usable for a name that was only separators", () => {
    expect(sanitizeImageFileName("..")).toBe("");
    expect(sanitizeImageFileName("/")).toBe("");
  });
});

describe("buildImageAssetTarget", () => {
  it("puts a pasted image in an assets folder beside the document", () => {
    const target = buildImageAssetTarget({
      documentPath: "docs/guide.md",
      image: { name: "", mimeType: "image/png" },
      now: NOW,
      index: 0,
    });
    expect(target).toEqual({ path: "docs/assets/pasted-image-20260802-163055.png" });
    // The link is built from the path the write actually took, never from the
    // path we asked for, so the two are asserted separately on purpose.
    expect(buildImageInsert("docs/guide.md", target!.path)).toBe(
      "![](assets/pasted-image-20260802-163055.png)",
    );
  });

  it("links back up out of the assets folder for a document at the root", () => {
    const target = buildImageAssetTarget({
      documentPath: "README.md",
      image: { name: "", mimeType: "image/png" },
      now: NOW,
      index: 0,
    });
    expect(target?.path).toBe("assets/pasted-image-20260802-163055.png");
    expect(buildImageInsert("README.md", target!.path)).toBe(
      "![](assets/pasted-image-20260802-163055.png)",
    );
  });

  it("keeps a dropped file's own name and extension", () => {
    const target = buildImageAssetTarget({
      documentPath: "docs/nested/guide.md",
      image: { name: "logo.svg", mimeType: "image/svg+xml" },
      now: NOW,
      index: 0,
    });
    expect(target?.path).toBe("docs/nested/assets/logo.svg");
    expect(buildImageInsert("docs/nested/guide.md", target!.path)).toBe("![](assets/logo.svg)");
  });

  it("cannot be talked out of the assets folder by the dropped name", () => {
    const target = buildImageAssetTarget({
      documentPath: "docs/guide.md",
      image: { name: "../../../../etc/cron.d/payload.png", mimeType: "image/png" },
      now: NOW,
      index: 0,
    });
    expect(target?.path).toBe("docs/assets/payload.png");
  });

  it("disambiguates several images dropped in one gesture", () => {
    const second = buildImageAssetTarget({
      documentPath: "README.md",
      image: { name: "", mimeType: "image/png" },
      now: NOW,
      index: 1,
    });
    expect(second?.path).toBe("assets/pasted-image-20260802-163055-2.png");
  });

  it("declines a drop that is not an image", () => {
    expect(
      buildImageAssetTarget({
        documentPath: "README.md",
        image: { name: "notes.pdf", mimeType: "application/pdf" },
        now: NOW,
        index: 0,
      }),
    ).toBeNull();
  });
});

describe("buildImageInsert", () => {
  it("percent-encodes what would end the link target early", () => {
    expect(buildImageInsert("README.md", "assets/my image.png")).toBe("![](assets/my%20image.png)");
  });

  it("climbs out of a nested document's directory", () => {
    expect(buildImageInsert("docs/deep/guide.md", "assets/x.png")).toBe("![](../../assets/x.png)");
  });
});

describe("suffixImageAssetPath", () => {
  it("suffixes the stem, not the extension", () => {
    expect(suffixImageAssetPath("docs/assets/logo.png", 2)).toBe("docs/assets/logo-2.png");
  });

  it("replaces its own previous suffix instead of stacking them", () => {
    expect(suffixImageAssetPath(suffixImageAssetPath("assets/logo.png", 2), 3)).toBe(
      "assets/logo-3.png",
    );
  });

  it("handles a name with no extension", () => {
    expect(suffixImageAssetPath("assets/logo", 2)).toBe("assets/logo-2");
  });
});
