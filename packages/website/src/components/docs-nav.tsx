import { Link, useLocation } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon } from "~/components/material-icons";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DocsNavNode } from "~/docs";

interface DocsNavProps {
  nodes: DocsNavNode[];
  basePath: string;
  mobile?: boolean;
  onNavigate?: () => void;
}

const ACTIVE_OPTIONS_EXACT = { exact: true };

function docsHref(href: string, basePath: string): string {
  return `${basePath}${href.slice("/docs".length)}`;
}

function nodeContainsHref(node: DocsNavNode, href: string, basePath: string): boolean {
  if (node.type === "page") return docsHref(node.href, basePath) === href;
  if (node.type === "group" && node.href !== undefined)
    return docsHref(node.href, basePath) === href;
  return node.children.some((child) => nodeContainsHref(child, href, basePath));
}

function clsx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * The sidebar scrolls independently of the page, so the active entry has to
 * bring itself into view. The entry owns this rather than the layout, because
 * a link inside a collapsed group only mounts once that group opens, and
 * anything watching from above would have to query before that happens.
 */
function useScrollIntoViewWhenActive(isActive: boolean) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (isActive) ref.current?.scrollIntoView({ block: "nearest" });
  }, [isActive]);

  return ref;
}

function PageLink({
  node,
  basePath,
  mobile,
  onNavigate,
}: {
  node: Extract<DocsNavNode, { type: "page" }>;
  basePath: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const href = docsHref(node.href, basePath);
  const isActive = location.pathname === href;
  const ref = useScrollIntoViewWhenActive(isActive);

  return (
    <Link
      ref={ref}
      to={href}
      activeOptions={ACTIVE_OPTIONS_EXACT}
      onClick={onNavigate}
      data-docs-nav-active={isActive ? "" : undefined}
      className={clsx(
        "block px-3 py-2 text-sm rounded-md transition-colors",
        mobile
          ? "text-muted-foreground hover:text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
        isActive && (mobile ? "text-foreground" : "bg-muted text-foreground"),
      )}
    >
      {node.label}
    </Link>
  );
}

function GroupNode({
  node,
  basePath,
  mobile,
  onNavigate,
}: {
  node: Extract<DocsNavNode, { type: "group" }>;
  basePath: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const currentHref = location.pathname;
  const containsActive = useMemo(
    () => nodeContainsHref(node, currentHref, basePath),
    [basePath, node, currentHref],
  );
  const href = node.href === undefined ? undefined : docsHref(node.href, basePath);
  const isActive = href === currentHref;
  const ref = useScrollIntoViewWhenActive(isActive);
  const [isOpen, setIsOpen] = useState(containsActive);
  const toggle = useCallback(() => setIsOpen((open) => !open), []);

  // Navigating into a group opens it. Navigating away must not close it, or a
  // group you opened to browse collapses the moment you click something else.
  useEffect(() => {
    if (containsActive) setIsOpen(true);
  }, [containsActive]);

  // The row is one target: it takes you to the group's page and opens it.
  // Clicking it again once you are already there collapses it.
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (isActive) {
        event.preventDefault();
        toggle();
        return;
      }
      setIsOpen(true);
      onNavigate?.();
    },
    [isActive, onNavigate, toggle],
  );

  const hasChildren = node.children.length > 0;
  const chevron = isOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />;
  const rowClassName = clsx(
    "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md transition-colors text-left",
    mobile
      ? "text-muted-foreground hover:text-foreground"
      : "text-muted-foreground hover:text-foreground hover:bg-muted",
    containsActive && "text-foreground",
    isActive && !mobile && "bg-muted",
  );

  return (
    <div>
      {href === undefined ? (
        <button type="button" onClick={toggle} aria-expanded={isOpen} className={rowClassName}>
          <span>{node.label}</span>
          {hasChildren && chevron}
        </button>
      ) : (
        <Link
          ref={ref}
          to={href}
          activeOptions={ACTIVE_OPTIONS_EXACT}
          onClick={handleClick}
          aria-expanded={hasChildren ? isOpen : undefined}
          data-docs-nav-active={isActive ? "" : undefined}
          className={rowClassName}
        >
          <span>{node.label}</span>
          {hasChildren && chevron}
        </Link>
      )}
      {isOpen && hasChildren && (
        <div className="ml-3 pl-3 border-l border-border space-y-0.5">
          <NavTree
            nodes={node.children}
            basePath={basePath}
            mobile={mobile}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
  );
}

function CategoryNode({
  node,
  basePath,
  mobile,
  onNavigate,
}: {
  node: Extract<DocsNavNode, { type: "category" }>;
  basePath: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className={mobile ? "space-y-1" : "space-y-1 mt-6 first:mt-0"}>
      <div className="px-3 py-2 text-xs font-medium text-foreground">{node.label}</div>
      <NavTree nodes={node.children} basePath={basePath} mobile={mobile} onNavigate={onNavigate} />
    </div>
  );
}

function NavTree({ nodes, basePath, mobile, onNavigate }: DocsNavProps) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => {
        if (node.type === "category") {
          return (
            <CategoryNode
              key={`category-${node.label}`}
              node={node}
              basePath={basePath}
              mobile={mobile}
              onNavigate={onNavigate}
            />
          );
        }
        if (node.type === "group") {
          return (
            <GroupNode
              key={`group-${node.segment}`}
              node={node}
              basePath={basePath}
              mobile={mobile}
              onNavigate={onNavigate}
            />
          );
        }
        return (
          <PageLink
            key={`page-${node.href}`}
            node={node}
            basePath={basePath}
            mobile={mobile}
            onNavigate={onNavigate}
          />
        );
      })}
    </div>
  );
}

export function DocsNav({ nodes, basePath, mobile, onNavigate }: DocsNavProps) {
  return (
    <div className={mobile ? undefined : "-ml-3"}>
      <NavTree nodes={nodes} basePath={basePath} mobile={mobile} onNavigate={onNavigate} />
    </div>
  );
}
