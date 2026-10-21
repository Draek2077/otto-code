import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "~/components/docs-page";
import { getDoc } from "~/docs";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/docs-app/")({
  head: () => {
    const doc = getDoc("");
    if (!doc) return pageMeta("Docs - Otto", "Otto documentation.", "/docs-app");
    return pageMeta(
      `${doc.frontmatter.title} - Otto Docs`,
      doc.frontmatter.description,
      "/docs-app",
    );
  },
  component: StandaloneDocsIndex,
});

function StandaloneDocsIndex() {
  return <DocsPage slug="" standalone />;
}
