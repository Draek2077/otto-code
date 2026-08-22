import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "~/components/docs-page";
import { getDoc } from "~/docs";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/docs/")({
  head: () => {
    const doc = getDoc("");
    if (!doc)
      return pageMeta(
        "Docs - Otto",
        "Install Otto and start running coding agents from your phone, desktop, and terminal.",
        "/docs",
      );
    return pageMeta(`${doc.frontmatter.title} - Otto Docs`, doc.frontmatter.description, "/docs");
  },
  component: DocsIndex,
});

function DocsIndex() {
  return <DocsPage slug="" />;
}
