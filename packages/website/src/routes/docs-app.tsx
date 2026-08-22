import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "~/components/docs-layout";

export const Route = createFileRoute("/docs-app")({
  component: StandaloneDocsLayout,
});

function StandaloneDocsLayout() {
  return <DocsLayout standalone />;
}
