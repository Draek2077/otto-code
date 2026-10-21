import { Outlet, useLocation } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { DocsBreadcrumbs } from "~/components/docs-breadcrumbs";
import { DocsNav } from "~/components/docs-nav";
import { DocsOutline } from "~/components/docs-outline";
import { CloseIcon, MenuIcon } from "~/components/material-icons";
import { SiteShell } from "~/components/site-shell";
import { buildDocsNavTree, getDoc, getDocs } from "~/docs";

interface DocsLayoutProps {
  standalone?: boolean;
}

function docSlug(pathname: string, basePath: string): string {
  if (pathname === basePath) return "";
  return pathname.slice(basePath.length + 1);
}

export function DocsLayout({ standalone = false }: DocsLayoutProps) {
  const location = useLocation();
  const basePath = standalone ? "/docs-app" : "/docs";
  const tree = useMemo(() => buildDocsNavTree(getDocs()), []);
  const doc = getDoc(docSlug(location.pathname, basePath));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const toggleMobileNav = useCallback(() => setMobileNavOpen((open) => !open), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const title = standalone ? "Otto Docs" : "Documentation";

  const docsContent = (
    <div className="mx-auto max-w-[90rem] border-t border-border">
      <header className="sticky top-3 z-40 border-b border-border bg-background lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-medium text-foreground">{title}</span>
          <button
            type="button"
            onClick={toggleMobileNav}
            aria-label={mobileNavOpen ? "Close documentation menu" : "Open documentation menu"}
            aria-expanded={mobileNavOpen}
            className="-mr-2 p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            {mobileNavOpen ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
          </button>
        </div>
        {mobileNavOpen && (
          <nav className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-border px-4 py-4">
            <DocsNav nodes={tree} basePath={basePath} mobile onNavigate={closeMobileNav} />
          </nav>
        )}
      </header>

      <div className="flex items-start">
        <aside className="sticky top-8 hidden h-[calc(100vh-4rem)] w-56 shrink-0 overflow-y-auto border-r border-border py-8 pr-6 lg:block">
          <div className="mb-4 px-3 text-xs font-medium text-muted-foreground">{title}</div>
          <DocsNav nodes={tree} basePath={basePath} />
        </aside>

        <main className="min-w-0 flex-1 px-6 py-8 md:px-10 md:py-12">
          <div className="mx-auto max-w-prose">
            {doc && <DocsBreadcrumbs doc={doc} tree={tree} basePath={basePath} />}
            <Outlet />
          </div>
        </main>

        <aside className="sticky top-8 hidden h-[calc(100vh-4rem)] w-52 shrink-0 overflow-y-auto xl:block">
          {doc && <DocsOutline headings={doc.headings} />}
        </aside>
      </div>
    </div>
  );

  if (standalone)
    return <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-8">{docsContent}</div>;

  return <SiteShell width="default">{docsContent}</SiteShell>;
}
