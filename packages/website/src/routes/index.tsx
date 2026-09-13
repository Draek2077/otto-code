import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "~/components/landing-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/")({
  head: () => {
    const metadata = pageMeta(
      "Otto: the agentic coding assistant for Claude Code, Codex, Copilot, and local models",
      "A fully featured, self-hosted agentic coding assistant: frontier-model tooling (browser-verified previews, artifacts, rich permission modes) for every provider, cloud and local alike. Drive it from your desk or your phone. No required cloud service or account.",
      "/",
    );
    return {
      ...metadata,
      meta: [
        ...metadata.meta,
        {
          name: "ahrefs-site-verification",
          content: "c31aa4957750063502ed5441f53ec97a36308e47321ba65eac0b5e4b04d1a97d",
        },
      ],
    };
  },
  component: Home,
});

function Home() {
  return (
    <LandingPage
      title="Agentic coding with personality, local or cloud."
      subtitle={
        <>
          <p className="text-white/70 text-lg leading-relaxed">
            Run Claude, Codex, OpenCode, OMP, and any OpenAI Compatible APIs on your local machine
            or cloud, from your desk or your phone.
          </p>
          <p className="text-white/70 text-lg leading-relaxed">
            Frontier-model tooling for every provider: agents that verify their work in the browser,
            artifacts, schedules, permission modes and more. Self-hosted, multi-provider, open
            source.
          </p>
        </>
      }
    />
  );
}
