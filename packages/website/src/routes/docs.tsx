import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "~/components/docs-layout";

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
});
