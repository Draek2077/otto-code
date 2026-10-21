// OTTO(website): retain Otto's public site on the clean Paseo base.
import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "~/components/docs-page";
import { getDoc } from "~/docs";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/docs/$")({
  head: ({ params }) => {
    const slug = params._splat ?? "";
    const path = `/docs/${slug}`;
    const doc = getDoc(slug);
    if (!doc) return pageMeta("Not Found - Otto Docs", "Doc not found.", path);
    return pageMeta(`${doc.frontmatter.title} - Otto Docs`, doc.frontmatter.description, path);
  },
  component: DocsRoutePage,
});

function DocsRoutePage() {
  const { _splat } = Route.useParams();
  const slug = _splat ?? "";
  return <DocsPage slug={slug} />;
}
