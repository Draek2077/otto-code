import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "~/components/docs-page";
import { getDoc } from "~/docs";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/docs-app/$")({
  head: ({ params }) => {
    const slug = params._splat ?? "";
    const path = `/docs-app/${slug}`;
    const doc = getDoc(slug);
    if (!doc) return pageMeta("Not Found - Otto Docs", "Doc not found.", path);
    return pageMeta(`${doc.frontmatter.title} - Otto Docs`, doc.frontmatter.description, path);
  },
  component: StandaloneDocsPage,
});

function StandaloneDocsPage() {
  const { _splat } = Route.useParams();
  return <DocsPage slug={_splat ?? ""} standalone />;
}
