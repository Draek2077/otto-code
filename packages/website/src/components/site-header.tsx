import "~/styles.css";
import { GitHubIcon } from "~/components/brand-icons";
import { useStars } from "~/routes/__root";

export function SiteHeader() {
  const { stars } = useStars();
  return (
    <header className="flex flex-col items-center gap-4 md:flex-row md:justify-between">
      <a href="/" className="flex items-center gap-3">
        <img src="/logo-wink.svg" alt="Otto" className="w-12 h-12" />
        <span className="text-lg font-medium">Otto</span>
      </a>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <a
          href="/blog"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Blog
        </a>
        <a
          href="/changelog"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Releases
        </a>
        <a
          href="/download"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Downloads
        </a>
        <a
          href="/docs"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Docs
        </a>
        <a
          href="/sponsor"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Support
        </a>
        <a
          href="https://github.com/Draek2077/otto-code"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={stars ? `GitHub, ${stars} stars` : "GitHub"}
          className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
        >
          <GitHubIcon width="18" height="18" />
          {stars && <span className="text-sm">{stars}</span>}
        </a>
      </div>
    </header>
  );
}
