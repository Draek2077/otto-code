import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { changelogLink } from "~/changelog";
import { CodeBlock } from "~/components/code-block";
import { SiteShell } from "~/components/site-shell";
import { pageMeta } from "~/meta";
import {
  downloadUrls,
  webAppUrl,
  MAC_UNSIGNED_NOTE,
  MAC_QUARANTINE_COMMAND,
  MAC_NO_AUTOUPDATE_NOTE,
  AppleIcon,
  AndroidIcon,
  WindowsIcon,
  LinuxIcon,
  TerminalIcon,
  GlobeIcon,
} from "~/downloads";
import { useBetaRelease, useRelease } from "~/routes/__root";
import "~/styles.css";

interface DownloadSearch {
  channel?: "beta";
}

const STABLE_SEARCH: DownloadSearch = {};
const BETA_SEARCH: DownloadSearch = { channel: "beta" };

export const Route = createFileRoute("/download")({
  validateSearch: (search: Record<string, unknown>): DownloadSearch =>
    search.channel === "beta" ? { channel: "beta" } : {},
  head: () =>
    pageMeta(
      "Download Otto for Windows, Linux, macOS, and Android",
      "Install Otto on your machines. Native desktop apps for Windows, Linux, and macOS, an Android APK, and a web app for everything else. Self-hosted, open source, free to download.",
      "/download",
    ),
  component: Download,
});

function Download() {
  const stable = useRelease();
  const beta = useBetaRelease();
  const { channel } = Route.useSearch();

  // A ?channel=beta link outlives the beta it was shared for, so the release
  // decides the channel, not the URL.
  const activeBeta = channel === "beta" ? beta : null;
  const onBeta = activeBeta !== null;
  const release = activeBeta ?? stable;
  const { version } = release;
  const urls = downloadUrls(release);

  return (
    <SiteShell width="default">
      <div className="mb-10 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-2">Download</h1>
          <p className="text-muted-foreground">
            v{version}
            <span className="mx-2 text-muted-foreground/40">·</span>
            <Link
              {...changelogLink(version)}
              className="underline underline-offset-4 decoration-border hover:text-foreground hover:decoration-current transition-colors"
            >
              What&apos;s new
            </Link>
          </p>
        </div>
        {beta && <ChannelSwitch onBeta={onBeta} />}
      </div>

      {onBeta && <BetaNotice />}

      {/* Desktop */}
      <section className="rounded-xl border border-border bg-card/40 p-6 md:p-8 mb-6">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h2 className="text-2xl font-semibold">Desktop</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Recommended, bundles everything you need
            </p>
          </div>
          <MonitorIcon className="h-5 w-5 text-muted-foreground mt-1.5" />
        </div>

        <div className="divide-y divide-border">
          {/* macOS: unsigned builds; the notes are load-bearing, see MAC_UNSIGNED_NOTE */}
          <div className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0">
            <PlatformRow icon={AppleIcon} label="macOS">
              <PillGroup>
                {urls.macDmgArm64 && <DownloadPill href={urls.macDmgArm64} label="Apple Silicon" />}
                {urls.macDmgX64 && <DownloadPill href={urls.macDmgX64} label="Intel" />}
                {!urls.macDmgArm64 && !urls.macDmgX64 && (
                  <p className="text-sm text-muted-foreground">
                    Not attached to this release. Check GitHub releases.
                  </p>
                )}
              </PillGroup>
            </PlatformRow>
            {(urls.macDmgArm64 || urls.macDmgX64) && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">{MAC_UNSIGNED_NOTE}</p>
                <CodeBlock size="sm">{MAC_QUARANTINE_COMMAND}</CodeBlock>
                <p className="text-sm text-muted-foreground">{MAC_NO_AUTOUPDATE_NOTE}</p>
              </div>
            )}
          </div>

          <PlatformRow icon={WindowsIcon} label="Windows">
            <PillGroup>
              <DownloadPill
                href={urls.windowsExeX64}
                label={urls.windowsExeArm64 ? "Intel / x64" : "Download"}
              />
              {urls.windowsExeArm64 && <DownloadPill href={urls.windowsExeArm64} label="ARM64" />}
            </PillGroup>
          </PlatformRow>

          <PlatformRow icon={LinuxIcon} label="Linux">
            <PillGroup>
              <DownloadPill href={urls.linuxAppImage} label="AppImage" />
              <DownloadPill href={urls.linuxDeb} label="DEB" />
              <DownloadPill href={urls.linuxRpm} label="RPM" />
            </PillGroup>
          </PlatformRow>
        </div>
      </section>

      {/* Mobile */}
      <section className="rounded-xl border border-border bg-card/40 p-6 md:p-8 mb-6">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-semibold">Mobile</h2>
          <PhoneIcon className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="divide-y divide-border">
          <PlatformRow icon={AndroidIcon} label="Android">
            <PillGroup>
              <DownloadPill href={urls.androidApk} label="APK" />
            </PillGroup>
          </PlatformRow>

          {/* iOS: no builds; unlike macOS there's no unsigned escape hatch */}
          <div className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <AppleIcon className="h-5 w-5 text-foreground" />
              <span className="font-medium">iOS</span>
            </div>
            <p className="text-sm text-muted-foreground sm:max-w-md sm:text-right">
              No iOS build yet. Use the web app from Safari, or connect from another device.
            </p>
          </div>
        </div>
      </section>

      {/* Web */}
      {!onBeta && (
        <section className="rounded-xl border border-border bg-card/40 p-6 md:p-8 mb-6">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h2 className="text-2xl font-semibold">Web</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Connect to a server from any browser
              </p>
            </div>
            <GlobeIcon className="h-5 w-5 text-muted-foreground mt-1.5" />
          </div>

          <div className="divide-y divide-border">
            <PlatformRow icon={GlobeIcon} label="Web App">
              <PillGroup>
                <DownloadPill href={webAppUrl} label="Open" external />
              </PillGroup>
            </PlatformRow>
          </div>
        </section>
      )}

      {/* Server */}
      <section className="rounded-xl border border-border bg-card/40 p-6 md:p-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h2 className="text-2xl font-semibold">Server</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Run the Otto server anywhere, connect from any client
            </p>
          </div>
          <TerminalIcon className="h-5 w-5 text-muted-foreground mt-1.5" />
        </div>

        <div className="divide-y divide-border">
          <PlatformRow icon={TerminalIcon} label="npm">
            <CodeBlock size="sm">
              {onBeta
                ? "npm install -g @otto-code/cli@beta && otto"
                : "npm install -g @otto-code/cli && otto"}
            </CodeBlock>
          </PlatformRow>

          <PlatformRow icon={TerminalIcon} label="Nix">
            <CodeBlock size="sm">
              {onBeta
                ? `nix run github:Draek2077/otto-code/v${version}`
                : "nix run github:Draek2077/otto-code"}
            </CodeBlock>
          </PlatformRow>
        </div>
      </section>

      <p className="text-center text-xs text-muted-foreground mt-8">
        All releases are available on{" "}
        <a
          href="https://github.com/Draek2077/otto-code/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground transition-colors"
        >
          GitHub
        </a>
        .
      </p>
    </SiteShell>
  );
}

function ChannelSwitch({ onBeta }: { onBeta: boolean }) {
  return (
    <div
      aria-label="Release channel"
      className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 p-1"
    >
      <ChannelOption label="Stable" active={!onBeta} search={STABLE_SEARCH} />
      <ChannelOption label="Beta" active={onBeta} search={BETA_SEARCH} />
    </div>
  );
}

function ChannelOption({
  label,
  active,
  search,
}: {
  label: string;
  active: boolean;
  search: DownloadSearch;
}) {
  return (
    <Link
      to="/download"
      search={search}
      replace
      resetScroll={false}
      aria-current={active ? "true" : undefined}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}

function BetaNotice() {
  return (
    <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-5 md:px-8 md:py-6">
      <p className="text-sm">Beta builds ship ahead of stable and can break.</p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Already running the desktop app? Set{" "}
        <span className="text-foreground">Settings → Release channel → Beta</span> and it updates
        itself from here on.
      </p>
    </div>
  );
}

function PlatformRow({
  icon: Icon,
  label,
  children,
}: {
  icon: (props: React.SVGProps<SVGSVGElement>) => ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-foreground" />
        <span className="font-medium">{label}</span>
      </div>
      {children}
    </div>
  );
}

function PillGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function DownloadPill({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:bg-foreground/85 transition-colors"
    >
      {label}
      {external && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="ml-1.5 h-3 w-3"
          aria-hidden="true"
        >
          <path d="M7 17L17 7" />
          <path d="M7 7h10v10" />
        </svg>
      )}
    </a>
  );
}

function MonitorIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

function PhoneIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}
