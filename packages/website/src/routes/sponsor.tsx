import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "~/components/site-shell";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/sponsor")({
  head: () =>
    pageMeta(
      "Support Mo, the author of Paseo",
      "Otto is an open-source fork of Paseo, built by Mo. Otto takes no sponsorships — all support goes directly to Mo, the author of the platform Otto is built on.",
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
          . We say that up front, and proudly: Paseo is a phenomenal platform — a self-hosted daemon
          for orchestrating coding agents across desktop, mobile, web, and CLI — and the fact that
          it&apos;s open source is what made Otto possible at all.
        </p>

        <p>
          Otto is a personal project. It began as one developer wanting to shape Paseo around a
          specific workflow — using AI coding agents to fork, refactor, and customize it to their
          own needs. On top of Mo&apos;s foundation it adds a refreshed UI, in-browser preview
          verification so agents can prove their changes work, and OpenAI-compatible model providers
          for running local and self-hosted models. All credit for the underlying platform belongs
          to Mo.
        </p>

        <p>
          To be transparent: Otto is not affiliated with or endorsed by Mo or Paseo. Paseo&apos;s
          community, sponsors, and reputation are Mo&apos;s accomplishments, not ours — we just
          think he deserves the credit and the support.
        </p>

        <p>
          Otto takes no sponsorships or donations of its own. If you&apos;d like to support the work
          behind Otto, please support Mo directly — he built the platform it all runs on.
        </p>
      </div>

      <section className="mt-12 space-y-4">
        <h2 className="text-xl font-medium">Support Mo</h2>

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
      </section>
    </SiteShell>
  );
}
