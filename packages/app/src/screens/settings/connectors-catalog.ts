// The connector directory: integrations a user can turn on without knowing what
// MCP is, what a transport is, or where a token goes.
//
// THE RULE THIS FILE EXISTS TO ENFORCE
// Every entry is a real, working server. No placeholders, no "fill this in
// yourself", no guessed package names or invented env vars. An entry carries
// `verifiedOn` and `source` precisely so the next person can re-check it rather
// than trust it. If you cannot cite a vendor doc for an endpoint, the entry does
// not belong here - send the user to "Add custom connector" instead.
//
// This replaced a catalog of ~70 labels whose every command was the literal
// string `npx -y <slug-mcp-server>`. It looked like a rich directory and was a
// directory of homework: nothing in it could start. Breadth that does not run is
// worse than a short list that does, because it costs the user the time to find
// out. The list below is shorter on purpose.
//
// Re-verification: these are third-party endpoints and they do move. Treat
// `verifiedOn` older than about six months as unverified and re-check it against
// `source` before trusting it.
//
// i18n: English-only pending a translation pass (build-first, translate-last).

export type ConnectorAudience = "user" | "developer";

/**
 * How a connector authenticates, and therefore what the UI must ask of the user.
 *
 * - `oauth` asks for nothing: one Connect button, a browser login, done. This is
 *   the shape the catalog prefers and the reason the daemon has an OAuth broker.
 * - `token` asks for one pasted secret, with a link to the exact page that
 *   issues it. Used only where the vendor offers no OAuth MCP endpoint.
 * - `none` asks for nothing because the server needs no account at all.
 */
export type ConnectorSetup =
  | {
      kind: "oauth";
      transport: "http" | "sse";
      url: string;
      /** Scopes to request, when the vendor requires them to be named. */
      scope?: string;
    }
  | {
      kind: "token";
      transport: "stdio";
      command: string;
      args: string[];
      credential: {
        /** Shown on the field, e.g. "Personal access token". */
        label: string;
        /** The env var the server actually reads. Verified, not guessed. */
        envVar: string;
        /** Deep link to the page that issues this credential. */
        issueUrl: string;
      };
    }
  | { kind: "none"; transport: "http"; url: string }
  | { kind: "none"; transport: "stdio"; command: string; args: string[] };

export interface ConnectorCatalogEntry {
  /** Stable slug; becomes the connector id when added. */
  id: string;
  label: string;
  category: string;
  audience: ConnectorAudience;
  /** What the user gets, in their terms. Not a description of MCP. */
  description: string;
  setup: ConnectorSetup;
  /** ISO date this entry's endpoint was last checked against `source`. */
  verifiedOn: string;
  /** The vendor doc the endpoint came from. Required: no citation, no entry. */
  source: string;
  homepage?: string;
}

const VERIFIED = "2026-08-03";

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  // ---- Sign-in connectors (OAuth) -----------------------------------------
  // These are the point of the whole subsystem: nothing to paste, nothing to
  // configure. Click Connect, log in on the vendor's page, the daemon holds the
  // token from then on.
  {
    id: "notion",
    label: "Notion",
    category: "Docs & knowledge",
    audience: "user",
    description: "Search, read, and write pages and databases in your Notion workspace.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.notion.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://developers.notion.com/docs/mcp",
    homepage: "https://www.notion.so",
  },
  {
    id: "atlassian",
    label: "Jira & Confluence",
    category: "Docs & knowledge",
    audience: "user",
    description: "Issues, sprints, and boards in Jira, plus spaces and pages in Confluence.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.atlassian.com/v1/mcp" },
    verifiedOn: VERIFIED,
    source: "https://www.atlassian.com/blog/announcements/remote-mcp-server",
    homepage: "https://www.atlassian.com",
  },
  {
    id: "box",
    label: "Box",
    category: "Docs & knowledge",
    audience: "user",
    description: "Enterprise files, folders, and shared content in Box.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.box.com" },
    verifiedOn: VERIFIED,
    source: "https://developer.box.com/guides/box-mcp",
    homepage: "https://www.box.com",
  },
  {
    id: "dropbox",
    label: "Dropbox",
    category: "Docs & knowledge",
    audience: "user",
    // Open beta since March 2026. Ships 23 file-centric tools.
    description: "Files, shared folders, and revision history in Dropbox.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.dropbox.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://help.dropbox.com/integrations/connect-dropbox-mcp-server",
    homepage: "https://www.dropbox.com",
  },
  {
    id: "slack",
    label: "Slack",
    category: "Communication",
    audience: "user",
    description: "Search, read, and post messages across your Slack channels.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.slack.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://docs.slack.dev/ai/slack-mcp-server/",
    homepage: "https://slack.com",
  },
  {
    id: "linear",
    label: "Linear",
    category: "Issues & projects",
    audience: "user",
    description: "Issues, projects, and cycles in Linear.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.linear.app/mcp" },
    verifiedOn: VERIFIED,
    source: "https://linear.app/docs/mcp",
    homepage: "https://linear.app",
  },
  {
    id: "monday",
    label: "monday.com",
    category: "Issues & projects",
    audience: "user",
    description: "Boards, items, and workflows in monday.com.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.monday.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://developer.monday.com/api-reference/docs/integrate-with-monday-mcp",
    homepage: "https://monday.com",
  },
  {
    id: "clickup",
    label: "ClickUp",
    category: "Issues & projects",
    audience: "user",
    description: "Tasks, docs, chat, and time tracking in ClickUp.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.clickup.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://mcp.clickup.com",
    homepage: "https://clickup.com",
  },
  {
    id: "trello",
    label: "Trello",
    category: "Issues & projects",
    audience: "user",
    // Consent is workspace-scoped: the user picks which Trello workspace the
    // assistant may touch, on Trello's own consent screen.
    description: "Boards, lists, and cards in Trello.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.trello.com/v1" },
    verifiedOn: VERIFIED,
    source: "https://github.com/atlassian/trello-mcp-server",
    homepage: "https://trello.com",
  },
  {
    id: "asana",
    label: "Asana",
    category: "Issues & projects",
    audience: "user",
    // SSE rather than streamable HTTP: Asana's published endpoint is an SSE one.
    // Kept as the vendor documents it rather than guessing at an /mcp twin.
    setup: { kind: "oauth", transport: "sse", url: "https://mcp.asana.com/sse" },
    description: "Tasks, projects, and portfolios in Asana.",
    verifiedOn: VERIFIED,
    source: "https://developers.asana.com/docs/using-asanas-model-control-protocol-mcp-server",
    homepage: "https://asana.com",
  },
  {
    id: "canva",
    label: "Canva",
    category: "Design & content",
    audience: "user",
    description: "Designs, brand assets, exports, and comments in Canva.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.canva.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://www.canva.dev/docs/connect/mcp-server/",
    homepage: "https://www.canva.com",
  },
  {
    id: "figma",
    label: "Figma",
    category: "Design & content",
    audience: "user",
    description: "Design files, frames, components, and design tokens in Figma.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.figma.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/",
    homepage: "https://www.figma.com",
  },
  {
    id: "webflow",
    label: "Webflow",
    category: "Design & content",
    audience: "user",
    description: "Sites, collections, and CMS items in Webflow.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.webflow.com/" },
    verifiedOn: VERIFIED,
    source: "https://developers.webflow.com/data/docs/ai-tools",
    homepage: "https://webflow.com",
  },
  {
    id: "intercom",
    label: "Intercom",
    category: "Support & revenue",
    audience: "user",
    description: "Conversations, contacts, and help-center content in Intercom.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.intercom.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://developers.intercom.com/docs/guides/mcp",
    homepage: "https://www.intercom.com",
  },
  {
    id: "hubspot",
    label: "HubSpot",
    category: "Support & revenue",
    audience: "user",
    description: "Contacts, deals, activity history, and marketing content in HubSpot.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.hubspot.com" },
    verifiedOn: VERIFIED,
    source: "https://developers.hubspot.com/mcp",
    homepage: "https://www.hubspot.com",
  },
  {
    id: "stripe",
    label: "Stripe",
    category: "Support & revenue",
    audience: "user",
    description: "Payments, subscriptions, refunds, and revenue data in Stripe.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.stripe.com" },
    verifiedOn: VERIFIED,
    source: "https://docs.stripe.com/mcp",
    homepage: "https://stripe.com",
  },
  {
    id: "square",
    label: "Square",
    category: "Support & revenue",
    audience: "user",
    // Beta, and gated to MCP clients Square has reviewed, so this can refuse
    // Otto for reasons unrelated to the user's account. The verification gate
    // reports whatever Square actually says.
    description: "Payments, orders, customers, catalog, and invoices in Square.",
    setup: { kind: "oauth", transport: "sse", url: "https://mcp.squareup.com/sse" },
    verifiedOn: VERIFIED,
    source: "https://developer.squareup.com/docs/mcp",
    homepage: "https://squareup.com",
  },
  {
    id: "airtable",
    label: "Airtable",
    category: "Data & spreadsheets",
    audience: "user",
    description: "Bases, tables, and records in Airtable.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.airtable.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://support.airtable.com/docs/using-the-airtable-mcp-server",
    homepage: "https://airtable.com",
  },
  {
    id: "ahrefs",
    label: "Ahrefs",
    category: "Marketing & SEO",
    audience: "user",
    description: "Backlinks, keywords, and SEO metrics from Ahrefs.",
    setup: { kind: "oauth", transport: "http", url: "https://api.ahrefs.com/mcp/mcp" },
    verifiedOn: VERIFIED,
    source: "https://github.com/ahrefs/ahrefs-mcp-server",
    homepage: "https://ahrefs.com",
  },

  // ---- Developer, sign-in --------------------------------------------------
  {
    id: "github",
    label: "GitHub",
    category: "Code hosting",
    audience: "developer",
    description: "Repositories, issues, pull requests, and Actions runs on GitHub.",
    setup: { kind: "oauth", transport: "http", url: "https://api.githubcopilot.com/mcp/" },
    verifiedOn: VERIFIED,
    source: "https://github.com/github/github-mcp-server",
    homepage: "https://github.com",
  },
  {
    id: "sentry",
    label: "Sentry",
    category: "Observability",
    audience: "developer",
    description: "Errors, issues, and releases in Sentry.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.sentry.dev/mcp" },
    verifiedOn: VERIFIED,
    source: "https://docs.sentry.io/product/sentry-mcp/",
    homepage: "https://sentry.io",
  },
  {
    id: "supabase",
    label: "Supabase",
    category: "Databases & backend",
    audience: "developer",
    description: "Postgres schema, data, edge functions, and branches on Supabase.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.supabase.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://supabase.com/docs/guides/ai-tools/mcp",
    homepage: "https://supabase.com",
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    category: "Infrastructure",
    audience: "developer",
    description: "DNS, Workers, R2, and the rest of the Cloudflare API.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.cloudflare.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://developers.cloudflare.com/agents/model-context-protocol/",
    homepage: "https://www.cloudflare.com",
  },
  {
    id: "netlify",
    label: "Netlify",
    category: "Infrastructure",
    audience: "developer",
    description: "Sites, deploys, and build logs on Netlify.",
    setup: { kind: "oauth", transport: "http", url: "https://netlify-mcp.netlify.app/mcp" },
    verifiedOn: VERIFIED,
    source: "https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/",
    homepage: "https://www.netlify.com",
  },
  {
    id: "vercel",
    label: "Vercel",
    category: "Infrastructure",
    audience: "developer",
    // Vercel gates its MCP endpoint to clients it has reviewed, so this can
    // legitimately refuse Otto with an authorization error that is nothing to do
    // with the user's account. The add-time verification gate surfaces whatever
    // Vercel actually says rather than us pretending it connected.
    description: "Projects, deployments, logs, and Web Analytics on Vercel.",
    setup: { kind: "oauth", transport: "http", url: "https://mcp.vercel.com" },
    verifiedOn: VERIFIED,
    source: "https://vercel.com/docs/agent-resources/vercel-mcp",
    homepage: "https://vercel.com",
  },

  // ---- No account needed ---------------------------------------------------
  {
    id: "deepwiki",
    label: "DeepWiki",
    category: "Docs & knowledge",
    audience: "developer",
    description: "Ask questions about any public GitHub repository's documentation.",
    setup: { kind: "none", transport: "http", url: "https://mcp.deepwiki.com/mcp" },
    verifiedOn: VERIFIED,
    source: "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
    homepage: "https://deepwiki.com",
  },
  {
    id: "semgrep",
    label: "Semgrep",
    category: "Observability",
    audience: "developer",
    description: "Scan code for security and correctness findings with Semgrep.",
    setup: { kind: "none", transport: "http", url: "https://mcp.semgrep.ai/mcp" },
    verifiedOn: VERIFIED,
    source: "https://github.com/semgrep/mcp",
    homepage: "https://semgrep.dev",
  },
  {
    id: "filesystem",
    label: "Local files",
    category: "Local tools",
    audience: "developer",
    // Reference server, actively maintained. Args are supplied by the UI (the
    // directories to expose), which is why this entry carries none.
    description: "Read and write files in directories you choose on this machine.",
    setup: {
      kind: "none",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
    },
    verifiedOn: VERIFIED,
    source: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "memory",
    label: "Persistent memory",
    category: "Local tools",
    audience: "user",
    description: "A knowledge graph the assistant can remember things in between chats.",
    setup: {
      kind: "none",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    },
    verifiedOn: VERIFIED,
    source: "https://github.com/modelcontextprotocol/servers",
  },
];

/**
 * What is missing from this list, and why. Two different reasons, and conflating
 * them is how this file went wrong twice.
 *
 * 1. BLOCKED ON A SETUP SHAPE WE HAVE NOT BUILT. These have real, verified,
 *    official endpoints. They are absent only because `ConnectorSetup` cannot yet
 *    express what they need:
 *      - own OAuth client id + secret: all of Google Workspace (Gmail, Drive,
 *        Docs, Sheets, Slides, Calendar, Chat, People)
 *      - templated URL: Microsoft 365 (tenant), GitLab (host), Shopify (store),
 *        Datadog (region), AWS (region), Salesforce (org), Microsoft Ads
 *      - client-credentials grant: PayPal
 *      - static API token: Bitbucket tools on the Atlassian endpoint
 *    Endpoints for every one of these are recorded in
 *    projects/connectors/connectors.md. Do not re-research them.
 *
 * 2. NO OFFICIAL SERVER EXISTS. Checked per vendor, not by a broad sweep:
 *    Zendesk (they are an MCP client, not a server publisher), Todoist, Google
 *    Search Console, Google Business Profile, LinkedIn Ads, Reddit Ads,
 *    StackAdapt, CircleCI, Apple Pages. Pinterest Ads has one but it is a
 *    partner-gated alpha.
 *
 * NEVER shipped, even though the package name looks right: the archived
 * reference servers (@modelcontextprotocol/server-github, -slack, -postgres,
 * -gdrive, -sqlite). The SQLite one carries an unpatched SQL injection flaw in a
 * frozen repository.
 *
 * The mistake to avoid: an earlier pass moved vendors into category 2 because one
 * broad search missed them. Slack, HubSpot, monday.com, Box, Airtable, Dropbox,
 * ClickUp, Trello, Ahrefs, Netlify and Square all publish official endpoints and
 * are in the list above. Check the vendor's own docs before declaring absence.
 */
export const KNOWN_ABSENT_NOTE =
  "Not listed here? Use Add custom connector with the server's own setup docs.";

/**
 * The catalog visible to a given mode. Developer sees everything; user sees only
 * user-audience entries, so non-coder surfaces are not peppered with
 * engineering connectors.
 */
export function catalogForAudience(audience?: ConnectorAudience): ConnectorCatalogEntry[] {
  if (audience === "user") {
    return CONNECTOR_CATALOG.filter((entry) => entry.audience === "user");
  }
  return CONNECTOR_CATALOG;
}

/** Group catalog entries by category, preserving first-seen category order. */
export function groupCatalogByCategory(
  entries: ConnectorCatalogEntry[],
): { category: string; entries: ConnectorCatalogEntry[] }[] {
  const groups: { category: string; entries: ConnectorCatalogEntry[] }[] = [];
  const byCategory = new Map<string, ConnectorCatalogEntry[]>();
  for (const entry of entries) {
    let bucket = byCategory.get(entry.category);
    if (!bucket) {
      bucket = [];
      byCategory.set(entry.category, bucket);
      groups.push({ category: entry.category, entries: bucket });
    }
    bucket.push(entry);
  }
  return groups;
}

/** True when connecting this entry means a browser login rather than a paste. */
export function isOAuthEntry(entry: ConnectorCatalogEntry): boolean {
  return entry.setup.kind === "oauth";
}

/**
 * Free-text search over the catalog. Matches the fields a user would actually
 * type: the name, what it does, and the category. Deliberately NOT the endpoint,
 * because nobody searches for a hostname, and matching one would make a search
 * for "mcp" return everything.
 *
 * An empty query returns the list unchanged, so callers can filter
 * unconditionally.
 */
export function searchCatalog(
  entries: ConnectorCatalogEntry[],
  query: string,
): ConnectorCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return entries;
  }
  return entries.filter(
    (entry) =>
      entry.label.toLowerCase().includes(needle) ||
      entry.description.toLowerCase().includes(needle) ||
      entry.category.toLowerCase().includes(needle),
  );
}
