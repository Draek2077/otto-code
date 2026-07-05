import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "~/components/landing-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/")({
  head: () =>
    pageMeta(
      "Otto – Run Claude Code, Codex, Copilot, OpenCode from anywhere",
      "Open-source fork of Paseo with a refreshed UI, in-browser preview verification, and OpenAI-compatible providers. Agents run on your machine. Connect from phone, desktop, or web.",
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
      subtitle="The full power of Paseo, with a unique twist: a refreshed UI, agents that verify their work in the browser, and any OpenAI-compatible model as a provider. Self-hosted, multi-provider, open source — proudly forked from Paseo."
    />
  );
}
