import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "~/components/landing-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/")({
  head: () =>
    pageMeta(
      "Otto – Run Claude Code, Codex, Copilot, OpenCode from anywhere",
      "Self-hosted coding-agent orchestration from your phone, desktop, or browser — with a better experience: refreshed UI, modern agentic task integrations, browser-verified changes, and new tools. Your code stays on your machines.",
      "/",
    ),
  component: Home,
});

function Home() {
  return (
    <LandingPage
      title={
        <>
          Orchestrate coding agents
          <br />
          from your desk and your phone
        </>
      }
      subtitle="Run Claude Code, Codex, OpenCode, and any OpenAI-compatible model on your own machines, and control them from your desk or your phone. Otto delivers a better, more complete experience — a refreshed UI, more modern agentic task integrations, agents that verify their own work in the browser, and new tools throughout. Self-hosted, multi-provider, open source — proudly forked from Paseo."
    />
  );
}
