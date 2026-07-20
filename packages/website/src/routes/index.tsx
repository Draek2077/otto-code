import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "~/components/landing-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/")({
  head: () =>
    pageMeta(
      "Otto – The agentic coding assistant for Claude Code, Codex, Copilot, and local models",
      "A fully featured, self-hosted agentic coding assistant: frontier-model tooling — browser-verified previews, artifacts, rich permission modes — for every provider, cloud and local alike. Drive it from your desk or your phone. Your code stays on your machines.",
      "/",
    ),
  component: Home,
});

function Home() {
  return (
    <LandingPage
      title={
        <>
          Agentic coding with personality,
          <br />
          for every model, cloud or local.
        </>
      }
      subtitle="Run Claude Code, Codex, OpenCode, and any OpenAI-compatible model on your own machines, from your desk or your phone. Frontier-model tooling for every provider: agents that verify their own work in the browser, artifacts, rich permission modes, and more. Self-hosted, multi-provider, open source."
    />
  );
}
