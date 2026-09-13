import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "~/components/site-shell";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageMeta(
      "Privacy Policy - Otto",
      "Privacy information for the self-hosted Otto app, optional relay, website analytics, and voluntary feedback.",
      "/privacy",
    ),
  component: Privacy,
});

function Privacy() {
  return (
    <SiteShell width="default">
      <h1 className="text-3xl font-medium mb-8">Privacy Policy</h1>

      <div className="space-y-6 text-white/70 leading-relaxed">
        <p>
          Otto is a self-hosted tool for managing coding agents. Its daemon and agents run in the
          environment you choose, with no required cloud service or account.
        </p>
        <p>
          For the security policy and responsibility disclaimer, see the{" "}
          <a href="/security" className="underline hover:text-white/90">
            Security Policy
          </a>
          .
        </p>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">Otto service data</h2>
          <p>
            Otto does not operate a mandatory hosted backend or collect app telemetry. If you opt
            into the hosted relay, the relay processing described below applies.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">The relay server</h2>
          <p>
            If you use the optional encrypted relay to connect your phone to your daemon, the relay
            sees:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>IP addresses and connection timing</li>
            <li>Message sizes</li>
            <li>Session IDs</li>
          </ul>
          <p>
            All messages between your phone and daemon are end-to-end encrypted with
            XSalsa20-Poly1305. The relay cannot read your messages, see your code, or decrypt your
            traffic.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">App and website</h2>
          <p>
            The Otto app does not collect app telemetry. The public website loads Plausible
            analytics. Visiting the website is separate from running the self-hosted app and daemon.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">Voluntary feedback</h2>
          <p>
            Sending feedback submits your message and any contact, context, or source information
            included in the report to the website&apos;s feedback endpoint. The endpoint forwards
            accepted reports to the configured feedback channel. It uses IP-based rate-limit records
            that expire after one hour to limit repeated submissions.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">Third-party services</h2>
          <p>
            Otto can run agent providers like Claude Code, Codex, and OpenCode. Cloud provider APIs,
            Git remotes, MCP servers, integrations, and other network-enabled tools you configure
            may transmit code, prompts, or other data according to their own policies and settings.
          </p>
          <p>Review and configure those services according to your own privacy requirements.</p>
          <p>
            If you use voice features with cloud providers (OpenAI speech), your voice data is sent
            to those services according to their privacy policies.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">I don&apos;t sell your data</h2>
          <p>Otto does not sell your data. It is self-hosted and local-first.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">Questions</h2>
          <p>
            If you have questions about privacy, open an issue on{" "}
            <a
              href="https://github.com/Draek2077/otto-code"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-white/90"
            >
              GitHub
            </a>
            .
          </p>
        </section>

        <p className="text-sm text-white/50 pt-6">Last updated: September 13, 2026</p>
      </div>
    </SiteShell>
  );
}
