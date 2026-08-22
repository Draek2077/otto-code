import { createFileRoute } from "@tanstack/react-router";
import { Children, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  changelogReleaseGroups,
  releaseAnchor,
  type ChangelogRelease,
  type ChangelogReleaseGroup,
} from "~/changelog";
import { SiteShell } from "~/components/site-shell";
import { pageMeta } from "~/meta";

function changelogCategoryTone(title: string): string {
  switch (title.toLowerCase()) {
    case "added":
      return "added";
    case "changed":
      return "changed";
    case "fixed":
      return "fixed";
    default:
      return "default";
  }
}

function ChangelogCategory({ children, className, ...props }: ComponentPropsWithoutRef<"h3">) {
  const title = Children.toArray(children)
    .filter((child): child is string => typeof child === "string")
    .join("");
  const classes = [
    "changelog-category",
    `changelog-category-${changelogCategoryTone(title)}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <h4 {...props} className={classes}>
      {children}
    </h4>
  );
}

const patchMarkdownComponents: Components = { h3: ChangelogCategory };

export const Route = createFileRoute("/changelog")({
  head: () =>
    pageMeta(
      "Releases - Otto",
      "Product updates, bug fixes, and improvements shipped in each Otto release. Track new agent providers, mobile features, and daemon changes over time.",
      "/changelog",
    ),
  component: Changelog,
});

function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function HeadingAnchor({ version }: { version: string }) {
  return (
    <a
      href={`#${releaseAnchor(version)}`}
      className="changelog-heading-anchor"
      aria-label={`Link to Otto ${version}`}
    >
      <span aria-hidden="true">#</span>
    </a>
  );
}

function PatchRelease({ release }: { release: ChangelogRelease }) {
  return (
    <section className="changelog-patch">
      <div id={releaseAnchor(release.version)} className="changelog-patch-heading">
        <HeadingAnchor version={release.version} />
        <h3 className="changelog-patch-title">{release.version}</h3>
        <time dateTime={release.date} className="changelog-release-date">
          {formatDate(release.date)}
        </time>
      </div>
      <div className="changelog-release-notes">
        <ReactMarkdown components={patchMarkdownComponents}>{release.markdown}</ReactMarkdown>
      </div>
    </section>
  );
}

function Release({ group }: { group: ChangelogReleaseGroup }) {
  return (
    <article className="changelog-release">
      <div id={releaseAnchor(group.version)} className="changelog-release-heading">
        <HeadingAnchor version={group.version} />
        <h2 className="changelog-release-title">
          Otto <span>{group.version}</span>
        </h2>
      </div>
      <div className="changelog-patches">
        {group.releases.map((release) => (
          <PatchRelease key={release.version} release={release} />
        ))}
      </div>
    </article>
  );
}

function Changelog() {
  return (
    <SiteShell width="default">
      <div className="changelog-page">
        <header className="page-intro">
          <h1 className="page-intro-title">Releases</h1>
          <p className="page-intro-subtitle">
            Everything new, improved, and fixed in Otto, newest first.
          </p>
        </header>
        <div className="changelog-timeline">
          {changelogReleaseGroups.map((group) => (
            <Release key={group.version} group={group} />
          ))}
        </div>
      </div>
    </SiteShell>
  );
}
