import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "~/components/site-shell";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/hub")({
  head: () =>
    pageMeta(
      "Paseo Hub reference",
      "Upstream Paseo Hub reference. Hub is disabled in Otto.",
      "/hub",
    ),
  component: Hub,
});

function Hub() {
  return (
    <SiteShell width="default">
      <h1 className="mb-4 text-3xl font-medium tracking-tight">Paseo Hub reference</h1>
      <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
        Hub is disabled in Otto. This page points to the separate upstream Paseo service; Otto does
        not provide its hosting, accounts or plans.
      </p>
      <div className="mt-10 max-w-2xl space-y-8">
        <section className="space-y-3">
          <h2 className="text-xl font-medium">What the upstream reference covers</h2>
          <p className="leading-relaxed text-muted-foreground">
            Paseo&apos;s v0.8.0 documentation describes triggers from GitHub, Slack and Discord,
            explicit daemon enrollment and execution permission, and follow-ups in the same agent
            conversation. New organization triggers and legacy project bundles have separate
            configuration and deployment paths.
          </p>
          <a href="/docs/hub" className="underline hover:text-foreground/80">
            Read the Paseo Hub reference
          </a>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-medium">Using Otto</h2>
          <p className="leading-relaxed text-muted-foreground">
            Otto runs agents, local schedules and orchestration without Hub. The Otto Hub command
            reports that it is disabled; it does not enroll your daemon or deploy triggers.
          </p>
          <div className="flex flex-wrap gap-4">
            <a href="/docs/schedules" className="underline hover:text-foreground/80">
              Local schedules
            </a>
            <a href="/docs/orchestration" className="underline hover:text-foreground/80">
              Orchestration
            </a>
          </div>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-medium">Paseo&apos;s service and source</h2>
          <p className="leading-relaxed text-muted-foreground">
            Availability, pricing and account terms belong to Paseo. Consult its service directly;
            this page does not fetch or present an Otto pricing offer.
          </p>
          <div className="flex flex-wrap gap-4">
            <a
              href="https://hub.paseo.sh"
              className="underline hover:text-foreground/80"
              target="_blank"
              rel="noopener noreferrer"
            >
              Paseo Hub
            </a>
            <a
              href="https://github.com/getpaseo/hub"
              className="underline hover:text-foreground/80"
              target="_blank"
              rel="noopener noreferrer"
            >
              Upstream Hub source
            </a>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
