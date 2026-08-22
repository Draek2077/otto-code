import type { ReactNode } from "react";
import { SiteFooter } from "~/components/site-footer";
import { SiteHeader } from "~/components/site-header";

interface SiteShellProps {
  children: ReactNode;
  width: "default" | "prose";
}

export function SiteShell({ children, width }: SiteShellProps) {
  const mainClasses = width === "prose" ? "site-frame site-frame-prose" : "site-frame";
  return (
    <div className="min-h-screen bg-background">
      <main className={mainClasses}>
        <div className="site-header-slot">
          <SiteHeader />
        </div>
        {children}
      </main>
      <SiteFooter width={width} />
    </div>
  );
}
