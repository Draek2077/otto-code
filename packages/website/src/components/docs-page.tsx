import { DocsMarkdown } from "~/components/docs-markdown";
import { DocsMarkdownActions } from "~/components/docs-markdown-actions";
import { DocsSourceFooter } from "~/components/docs-source-footer";
import { getDoc } from "~/docs";

interface DocsPageProps {
  slug: string;
  standalone?: boolean;
}

export function DocsPage({ slug, standalone = false }: DocsPageProps) {
  const doc = getDoc(slug);

  if (!doc) return <p className="text-muted-foreground">Doc not found.</p>;

  const markdownHref = slug === "" ? "/docs.md" : `/docs/${slug}.md`;

  return (
    <>
      <DocsMarkdownActions
        content={doc.content}
        markdownHref={standalone ? undefined : markdownHref}
      />
      <DocsMarkdown standalone={standalone}>{doc.content}</DocsMarkdown>
      {!standalone && <DocsSourceFooter doc={doc} />}
    </>
  );
}
