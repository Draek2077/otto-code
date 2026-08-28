import { describe, expect, it } from "vitest";
import type { ProjectKnowledgeListResponseMessage } from "@otto-code/protocol/messages";
import {
  findProjectKnowledgeFileSelection,
  findRepositoryKnowledgeFileSelection,
  isMarkdownFilePath,
} from "./file-target";

type ProjectKnowledgePayload = ProjectKnowledgeListResponseMessage["payload"];

const view: ProjectKnowledgePayload = {
  requestId: "test",
  records: [
    {
      id: "editor-canvas",
      kind: "requirement",
      title: "Knowledge uses the editor canvas",
      statement: "Use the editor canvas.",
      tags: [],
      status: "confirmed",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
      path: ".otto/knowledge/requirements/editor-canvas.md",
      absolutePath:
        "C:/Users/me/.otto/project-knowledge/repo/knowledge/requirements/editor-canvas.md",
    },
  ],
  rootPages: [
    {
      slug: "architecture",
      title: "Architecture",
      path: ".otto/knowledge/architecture.md",
      absolutePath: "C:/Users/me/repo/.otto/knowledge/architecture.md",
      body: "# Architecture",
    },
  ],
  findings: [],
  brief: "",
  briefTokens: 0,
  includedIds: [],
  omittedCount: 0,
};

describe("findProjectKnowledgeFileSelection", () => {
  it("selects a repository-backed root from its explorer path", () => {
    expect(
      findProjectKnowledgeFileSelection({ path: ".otto\\knowledge\\architecture.md", view }),
    ).toEqual({ kind: "root", slug: "architecture" });
  });

  it("selects a host-backed record from its absolute path", () => {
    expect(
      findProjectKnowledgeFileSelection({
        path: "c:/users/me/.otto/project-knowledge/repo/knowledge/requirements/editor-canvas.md",
        view,
      }),
    ).toEqual({ kind: "record", id: "editor-canvas" });
  });

  it("leaves project guidance and generated metadata in the File Editor", () => {
    expect(findProjectKnowledgeFileSelection({ path: ".otto/KNOWLEDGE.md", view })).toBeNull();
    expect(
      findProjectKnowledgeFileSelection({ path: ".otto/knowledge/index.md", view }),
    ).toBeNull();
  });
});

describe("findRepositoryKnowledgeFileSelection", () => {
  it("selects a canonical article synchronously from the Explorer path", () => {
    expect(findRepositoryKnowledgeFileSelection(".otto/knowledge/architecture.md")).toEqual({
      kind: "root",
      slug: "architecture",
    });
    expect(
      findRepositoryKnowledgeFileSelection(
        "C:/Users/me/repo/.otto/knowledge/requirements/editor-canvas.md",
      ),
    ).toEqual({ kind: "record", id: "editor-canvas" });
  });

  it("does not mistake generated metadata or a non-Knowledge folder for an article", () => {
    expect(findRepositoryKnowledgeFileSelection(".otto/knowledge/index.md")).toBeNull();
    expect(
      findRepositoryKnowledgeFileSelection("docs/knowledge/requirements/example.md"),
    ).toBeNull();
  });
});

describe("isMarkdownFilePath", () => {
  it("recognizes Markdown without treating other file types as Knowledge candidates", () => {
    expect(isMarkdownFilePath("README.MD")).toBe(true);
    expect(isMarkdownFilePath("README.md.bak")).toBe(false);
  });
});
