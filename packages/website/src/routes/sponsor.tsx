import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "~/components/site-shell";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/sponsor")({
  head: () =>
    pageMeta(
      "Support the projects Otto is built on",
      "Otto takes no sponsorships. Support goes to the open-source projects underneath it — Paseo by Mo, and Agent Flow by Simon Patole.",
      "/sponsor",
    ),
  component: Sponsor,
});

function Sponsor() {
  return (
    <SiteShell width="default">
      <h1 className="text-3xl font-medium tracking-tight mb-8">Support</h1>

      <div className="space-y-6 text-white/70 leading-relaxed max-w-2xl">
        <p>
          Otto is an independent open-source fork of{" "}
          <a
            href="https://github.com/getpaseo/paseo"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Paseo
          </a>
          , created by{" "}
          <a
            href="https://github.com/boudra"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Mo
          </a>
          . I say that up front, and proudly: Paseo is a phenomenal platform — a self-hosted daemon
          for orchestrating coding agents across desktop, mobile, web, and CLI — and the fact that
          it&apos;s open source is what made Otto possible at all.
        </p>

        <p>
          Otto is a personal project by Philippe — not a startup, just the environment I want to
          work in and the way I&apos;m getting better at agentic coding. Most of Otto is written by
          the agents Otto runs. The problem I keep hitting is that agents can now do an enormous
          amount of work on their own, and it&apos;s hard to see what they did, what it cost, and
          where it went sideways — so the work leans toward making that legible, and toward pulling
          good open-source pieces into one setup that works end to end.
        </p>

        <p>
          Which means Otto is mostly other people&apos;s hard work, assembled — and the two projects
          it leans on hardest deserve naming properly.
        </p>

        <p>
          <strong className="font-medium text-white/90">Paseo</strong> is the foundation. Mo got the
          hard parts right before I ever showed up: agent process lifecycle, a clean WebSocket
          protocol, genuinely cross-platform clients, an end-to-end encrypted relay. Everything Otto
          adds is features on top of infrastructure that already worked.
        </p>

        <p>
          <strong className="font-medium text-white/90">
            <a
              href="https://github.com/patoles/agent-flow"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-white/80"
            >
              Agent Flow
            </a>
          </strong>{" "}
          (Apache-2.0) by{" "}
          <a
            href="https://github.com/patoles"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Simon Patole
          </a>{" "}
          is the render layer behind Otto&apos;s Visualizer — the live node-graph of agents,
          subagents, tool calls, and timeline that makes an autonomous run something you can watch
          instead of guess at. It&apos;s beautiful work, and it fit because Simon kept rendering
          separate from event collection behind a small documented bridge protocol. That one
          decision let Otto drive the same graph from its own provider-neutral event stream, so it
          lights up for Claude, Codex, OpenCode, or a local model alike. Adapting it has been the
          most enjoyable part of building Otto.
        </p>

        <p>
          To be transparent: Otto is not affiliated with or endorsed by Paseo or Agent Flow. Their
          communities, sponsors, and reputations are their authors&apos; accomplishments, not mine —
          I just think they deserve the credit and the support. Agent Flow&apos;s name and logos are
          its own; Otto never ships them as its own branding.
        </p>

        <p>
          Otto takes no sponsorships or donations of its own. If you&apos;d like to support the work
          behind Otto, support the projects underneath it instead.
        </p>
      </div>

      <section className="mt-12 space-y-4">
        <h2 className="text-xl font-medium">Support the projects Otto is built on</h2>

        <div className="flex flex-col sm:flex-row gap-4">
          <a
            href="https://github.com/sponsors/boudra"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5 hover:border-white/20 hover:bg-white/[0.05] transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="text-pink-400"
            >
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            <div>
              <p className="font-medium text-white">GitHub Sponsors</p>
              <p className="text-sm text-white/50">Sponsor Mo, the author of Paseo</p>
            </div>
          </a>

          <a
            href="https://github.com/boudra"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5 hover:border-white/20 hover:bg-white/[0.05] transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="text-white/60"
            >
              <path d="M12 0C5.37 0 0 5.484 0 12.252c0 5.418 3.438 10.013 8.205 11.637.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.738-4.042-1.61-4.042-1.61-.546-1.403-1.333-1.776-1.333-1.776-1.089-.756.084-.741.084-.741 1.205.087 1.838 1.262 1.838 1.262 1.07 1.87 2.809 1.33 3.495 1.017.108-.79.417-1.33.76-1.636-2.665-.31-5.467-1.35-5.467-6.005 0-1.327.465-2.413 1.235-3.262-.124-.31-.535-1.556.117-3.243 0 0 1.008-.33 3.3 1.248a11.2 11.2 0 0 1 3.003-.404c1.02.005 2.045.138 3.003.404 2.29-1.578 3.297-1.248 3.297-1.248.653 1.687.242 2.933.118 3.243.77.85 1.233 1.935 1.233 3.262 0 4.667-2.807 5.692-5.48 5.995.43.38.823 1.133.823 2.285 0 1.65-.015 2.98-.015 3.386 0 .315.218.694.825.576C20.565 22.26 24 17.667 24 12.252 24 5.484 18.627 0 12 0z" />
            </svg>
            <div>
              <p className="font-medium text-white">Mo on GitHub</p>
              <p className="text-sm text-white/50">Follow his work, including Paseo</p>
            </div>
          </a>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <a
            href="https://github.com/patoles/agent-flow"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5 hover:border-white/20 hover:bg-white/[0.05] transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="text-amber-300"
            >
              <path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21.02 7 14.14l-5-4.87 7.1-1.01L12 2z" />
            </svg>
            <div>
              <p className="font-medium text-white">Star Agent Flow</p>
              <p className="text-sm text-white/50">
                The render layer behind Otto&apos;s Visualizer
              </p>
            </div>
          </a>

          <a
            href="https://github.com/patoles"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5 hover:border-white/20 hover:bg-white/[0.05] transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="text-white/60"
            >
              <path d="M12 0C5.37 0 0 5.484 0 12.252c0 5.418 3.438 10.013 8.205 11.637.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.738-4.042-1.61-4.042-1.61-.546-1.403-1.333-1.776-1.333-1.776-1.089-.756.084-.741.084-.741 1.205.087 1.838 1.262 1.838 1.262 1.07 1.87 2.809 1.33 3.495 1.017.108-.79.417-1.33.76-1.636-2.665-.31-5.467-1.35-5.467-6.005 0-1.327.465-2.413 1.235-3.262-.124-.31-.535-1.556.117-3.243 0 0 1.008-.33 3.3 1.248a11.2 11.2 0 0 1 3.003-.404c1.02.005 2.045.138 3.003.404 2.29-1.578 3.297-1.248 3.297-1.248.653 1.687.242 2.933.118 3.243.77.85 1.233 1.935 1.233 3.262 0 4.667-2.807 5.692-5.48 5.995.43.38.823 1.133.823 2.285 0 1.65-.015 2.98-.015 3.386 0 .315.218.694.825.576C20.565 22.26 24 17.667 24 12.252 24 5.484 18.627 0 12 0z" />
            </svg>
            <div>
              <p className="font-medium text-white">Simon Patole on GitHub</p>
              <p className="text-sm text-white/50">Author of Agent Flow</p>
            </div>
          </a>
        </div>
      </section>
    </SiteShell>
  );
}
