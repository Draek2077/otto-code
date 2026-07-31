// Curated connector catalog — the "Browse connectors" directory the picker
// renders. Each entry is tagged with an audience: "user" entries appear in both
// User and Developer mode; "developer" entries appear in Developer mode only, so
// non-coder surfaces never get peppered with engineering connectors.
//
// IMPORTANT: the `template` command/URL and `credential.envVar` here are
// STARTING POINTS, not verified live values. The MCP connector ecosystem moves
// fast and package names / endpoints / token env vars change. The picker
// pre-fills these into an editable form; the user confirms them against the
// connector's official MCP docs before adding. We deliberately do not assert
// exact package identifiers here.
//
// i18n: English-only pending a translation pass (build-first, translate-last).
import type { ConnectorTransport } from "./connectors-config";

export type ConnectorAudience = "user" | "developer";

export interface ConnectorCredentialSlot {
  // Human label for the secret the connector needs (shown on the token field).
  label: string;
  // stdio: the env var the token is injected into. Absent for http/sse, where
  // the token rides an Authorization: Bearer header instead.
  envVar?: string;
}

export interface ConnectorCatalogEntry {
  // Stable slug; becomes the connector id when added.
  id: string;
  label: string;
  category: string;
  audience: ConnectorAudience;
  description: string;
  transport: ConnectorTransport;
  // Starting-point command (stdio) or URL (http/sse) the picker pre-fills.
  template: string;
  // The credential the connector needs, if any. Presence reveals a token field.
  credential?: ConnectorCredentialSlot;
  // Vendor site, so the user can find the connector's official MCP setup docs.
  homepage?: string;
}

// A generic stdio starting point: an npx-run MCP server package the user fills
// in. Kept as a visible placeholder so no fabricated package name is asserted.
const STDIO = (slug: string): string => `npx -y <${slug}-mcp-server>`;

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  // ---- User (also shown in Developer mode) --------------------------------
  // Docs & storage
  {
    id: "google-drive",
    label: "Google Drive",
    category: "Docs & storage",
    audience: "user",
    description: "Read and write files and Google Docs in your Drive.",
    transport: "stdio",
    template: STDIO("google-drive"),
    credential: { label: "Google access token", envVar: "GOOGLE_ACCESS_TOKEN" },
    homepage: "https://workspace.google.com",
  },
  {
    id: "onedrive",
    label: "OneDrive / SharePoint",
    category: "Docs & storage",
    audience: "user",
    description: "Microsoft 365 files and SharePoint document libraries.",
    transport: "stdio",
    template: STDIO("onedrive"),
    credential: { label: "Microsoft access token", envVar: "MS_ACCESS_TOKEN" },
    homepage: "https://www.microsoft.com/microsoft-365",
  },
  {
    id: "dropbox",
    label: "Dropbox",
    category: "Docs & storage",
    audience: "user",
    description: "Files and shared folders in Dropbox.",
    transport: "stdio",
    template: STDIO("dropbox"),
    credential: { label: "Dropbox access token", envVar: "DROPBOX_ACCESS_TOKEN" },
    homepage: "https://www.dropbox.com",
  },
  {
    id: "box",
    label: "Box",
    category: "Docs & storage",
    audience: "user",
    description: "Enterprise file storage and shared content in Box.",
    transport: "stdio",
    template: STDIO("box"),
    credential: { label: "Box access token", envVar: "BOX_ACCESS_TOKEN" },
    homepage: "https://www.box.com",
  },
  {
    id: "notion",
    label: "Notion",
    category: "Docs & storage",
    audience: "user",
    description: "Pages, databases, and wikis in your Notion workspace.",
    transport: "stdio",
    template: STDIO("notion"),
    credential: { label: "Notion integration token", envVar: "NOTION_TOKEN" },
    homepage: "https://www.notion.so",
  },
  {
    id: "confluence",
    label: "Confluence",
    category: "Docs & storage",
    audience: "user",
    description: "Atlassian Confluence spaces and pages.",
    transport: "stdio",
    template: STDIO("confluence"),
    credential: { label: "Atlassian API token", envVar: "ATLASSIAN_API_TOKEN" },
    homepage: "https://www.atlassian.com/software/confluence",
  },
  // Communication
  {
    id: "slack",
    label: "Slack",
    category: "Communication",
    audience: "user",
    description: "Post to and read from Slack channels and DMs.",
    transport: "stdio",
    template: STDIO("slack"),
    credential: { label: "Slack bot token", envVar: "SLACK_BOT_TOKEN" },
    homepage: "https://slack.com",
  },
  {
    id: "gmail",
    label: "Gmail",
    category: "Communication",
    audience: "user",
    description: "Read, search, and draft email in Gmail.",
    transport: "stdio",
    template: STDIO("gmail"),
    credential: { label: "Google access token", envVar: "GOOGLE_ACCESS_TOKEN" },
    homepage: "https://mail.google.com",
  },
  {
    id: "outlook",
    label: "Outlook",
    category: "Communication",
    audience: "user",
    description: "Microsoft Outlook mail and contacts.",
    transport: "stdio",
    template: STDIO("outlook"),
    credential: { label: "Microsoft access token", envVar: "MS_ACCESS_TOKEN" },
    homepage: "https://outlook.com",
  },
  {
    id: "teams",
    label: "Microsoft Teams",
    category: "Communication",
    audience: "user",
    description: "Post and read messages in Microsoft Teams channels.",
    transport: "stdio",
    template: STDIO("teams"),
    credential: { label: "Microsoft access token", envVar: "MS_ACCESS_TOKEN" },
    homepage: "https://www.microsoft.com/microsoft-teams",
  },
  // Calendar & tasks
  {
    id: "google-calendar",
    label: "Google Calendar",
    category: "Calendar & tasks",
    audience: "user",
    description: "Read and create calendar events.",
    transport: "stdio",
    template: STDIO("google-calendar"),
    credential: { label: "Google access token", envVar: "GOOGLE_ACCESS_TOKEN" },
    homepage: "https://calendar.google.com",
  },
  {
    id: "asana",
    label: "Asana",
    category: "Calendar & tasks",
    audience: "user",
    description: "Projects, tasks, and workloads in Asana.",
    transport: "stdio",
    template: STDIO("asana"),
    credential: { label: "Asana access token", envVar: "ASANA_ACCESS_TOKEN" },
    homepage: "https://asana.com",
  },
  {
    id: "todoist",
    label: "Todoist",
    category: "Calendar & tasks",
    audience: "user",
    description: "Personal and shared task lists in Todoist.",
    transport: "stdio",
    template: STDIO("todoist"),
    credential: { label: "Todoist API token", envVar: "TODOIST_API_TOKEN" },
    homepage: "https://todoist.com",
  },
  {
    id: "trello",
    label: "Trello",
    category: "Calendar & tasks",
    audience: "user",
    description: "Boards, lists, and cards in Trello.",
    transport: "stdio",
    template: STDIO("trello"),
    credential: { label: "Trello API token", envVar: "TRELLO_TOKEN" },
    homepage: "https://trello.com",
  },
  {
    id: "monday",
    label: "Monday.com",
    category: "Calendar & tasks",
    audience: "user",
    description: "Work-management boards in monday.com.",
    transport: "stdio",
    template: STDIO("monday"),
    credential: { label: "monday.com API token", envVar: "MONDAY_API_TOKEN" },
    homepage: "https://monday.com",
  },
  // Data & spreadsheets
  {
    id: "google-sheets",
    label: "Google Sheets",
    category: "Data & spreadsheets",
    audience: "user",
    description: "Read and write spreadsheet data in Google Sheets.",
    transport: "stdio",
    template: STDIO("google-sheets"),
    credential: { label: "Google access token", envVar: "GOOGLE_ACCESS_TOKEN" },
    homepage: "https://sheets.google.com",
  },
  {
    id: "airtable",
    label: "Airtable",
    category: "Data & spreadsheets",
    audience: "user",
    description: "Bases, tables, and records in Airtable.",
    transport: "stdio",
    template: STDIO("airtable"),
    credential: { label: "Airtable API token", envVar: "AIRTABLE_API_KEY" },
    homepage: "https://airtable.com",
  },
  {
    id: "excel-365",
    label: "Microsoft Excel",
    category: "Data & spreadsheets",
    audience: "user",
    description: "Workbooks and worksheets in Microsoft 365.",
    transport: "stdio",
    template: STDIO("excel"),
    credential: { label: "Microsoft access token", envVar: "MS_ACCESS_TOKEN" },
    homepage: "https://www.microsoft.com/microsoft-365/excel",
  },
  // CRM & support
  {
    id: "hubspot",
    label: "HubSpot",
    category: "CRM & support",
    audience: "user",
    description: "Contacts, deals, and CRM data in HubSpot.",
    transport: "stdio",
    template: STDIO("hubspot"),
    credential: { label: "HubSpot private app token", envVar: "HUBSPOT_ACCESS_TOKEN" },
    homepage: "https://www.hubspot.com",
  },
  {
    id: "salesforce",
    label: "Salesforce",
    category: "CRM & support",
    audience: "user",
    description: "Accounts, opportunities, and reports in Salesforce.",
    transport: "stdio",
    template: STDIO("salesforce"),
    credential: { label: "Salesforce access token", envVar: "SALESFORCE_ACCESS_TOKEN" },
    homepage: "https://www.salesforce.com",
  },
  {
    id: "zendesk",
    label: "Zendesk",
    category: "CRM & support",
    audience: "user",
    description: "Support tickets and help-center content in Zendesk.",
    transport: "stdio",
    template: STDIO("zendesk"),
    credential: { label: "Zendesk API token", envVar: "ZENDESK_API_TOKEN" },
    homepage: "https://www.zendesk.com",
  },
  {
    id: "intercom",
    label: "Intercom",
    category: "CRM & support",
    audience: "user",
    description: "Conversations and customer data in Intercom.",
    transport: "stdio",
    template: STDIO("intercom"),
    credential: { label: "Intercom access token", envVar: "INTERCOM_ACCESS_TOKEN" },
    homepage: "https://www.intercom.com",
  },
  // Analytics & revenue
  {
    id: "google-analytics",
    label: "Google Analytics",
    category: "Analytics & revenue",
    audience: "user",
    description: "Traffic and engagement metrics for reporting.",
    transport: "stdio",
    template: STDIO("google-analytics"),
    credential: { label: "Google access token", envVar: "GOOGLE_ACCESS_TOKEN" },
    homepage: "https://analytics.google.com",
  },
  {
    id: "stripe",
    label: "Stripe",
    category: "Analytics & revenue",
    audience: "user",
    description: "Revenue, subscriptions, and payout data for reports.",
    transport: "stdio",
    template: STDIO("stripe"),
    credential: { label: "Stripe secret key", envVar: "STRIPE_API_KEY" },
    homepage: "https://stripe.com",
  },
  // Visual deliverables
  {
    id: "canva",
    label: "Canva",
    category: "Visual deliverables",
    audience: "user",
    description: "Designs and brand assets in Canva.",
    transport: "stdio",
    template: STDIO("canva"),
    credential: { label: "Canva access token", envVar: "CANVA_ACCESS_TOKEN" },
    homepage: "https://www.canva.com",
  },
  {
    id: "figma",
    label: "Figma",
    category: "Visual deliverables",
    audience: "user",
    description: "Design files, frames, and assets in Figma.",
    transport: "stdio",
    template: STDIO("figma"),
    credential: { label: "Figma access token", envVar: "FIGMA_ACCESS_TOKEN" },
    homepage: "https://www.figma.com",
  },
  // Office documents — PowerPoint is Microsoft 365 (cloud); Pages and PDF are
  // local document tools that read/write those formats (no cloud account). Note:
  // native generation/export of these deliverable formats is the User Mode
  // charter's deliverables work, separate from these read/write connectors.
  {
    id: "powerpoint",
    label: "Microsoft PowerPoint",
    category: "Office documents",
    audience: "user",
    description: "Presentations in Microsoft 365.",
    transport: "stdio",
    template: STDIO("powerpoint"),
    credential: { label: "Microsoft access token", envVar: "MS_ACCESS_TOKEN" },
    homepage: "https://www.microsoft.com/microsoft-365/powerpoint",
  },
  {
    id: "apple-pages",
    label: "Apple Pages",
    category: "Office documents",
    audience: "user",
    description: "Read and write Apple Pages documents on this machine.",
    transport: "stdio",
    template: STDIO("pages"),
    homepage: "https://www.apple.com/pages",
  },
  {
    id: "pdf-tools",
    label: "PDF tools",
    category: "Office documents",
    audience: "user",
    description: "Read, extract, fill, and assemble PDF files on this machine.",
    transport: "stdio",
    template: STDIO("pdf"),
  },
  // Ecommerce
  {
    id: "shopify",
    label: "Shopify",
    category: "Ecommerce",
    audience: "user",
    description: "Products, orders, and store data in Shopify.",
    transport: "stdio",
    template: STDIO("shopify"),
    credential: { label: "Shopify access token", envVar: "SHOPIFY_ACCESS_TOKEN" },
    homepage: "https://www.shopify.com",
  },
  // ClickUp joins the existing Calendar & tasks group.
  {
    id: "clickup",
    label: "ClickUp",
    category: "Calendar & tasks",
    audience: "user",
    description: "Tasks, docs, and projects in ClickUp.",
    transport: "stdio",
    template: STDIO("clickup"),
    credential: { label: "ClickUp API token", envVar: "CLICKUP_API_TOKEN" },
    homepage: "https://clickup.com",
  },
  // Marketing & SEO
  {
    id: "ahrefs",
    label: "Ahrefs",
    category: "Marketing & SEO",
    audience: "user",
    description: "Backlinks, keywords, and SEO metrics from Ahrefs.",
    transport: "stdio",
    template: STDIO("ahrefs"),
    credential: { label: "Ahrefs API token", envVar: "AHREFS_API_TOKEN" },
    homepage: "https://ahrefs.com",
  },
  {
    id: "google-search-console",
    label: "Google Search Console",
    category: "Marketing & SEO",
    audience: "user",
    description: "Search queries, impressions, and indexing data.",
    transport: "stdio",
    template: STDIO("google-search-console"),
    credential: { label: "Google access token", envVar: "GOOGLE_ACCESS_TOKEN" },
    homepage: "https://search.google.com/search-console",
  },
  {
    id: "google-business-profile",
    label: "Google Business Profile",
    category: "Marketing & SEO",
    audience: "user",
    description: "Local listings, reviews, and insights (formerly My Business).",
    transport: "stdio",
    template: STDIO("google-business-profile"),
    credential: { label: "Google access token", envVar: "GOOGLE_ACCESS_TOKEN" },
    homepage: "https://www.google.com/business",
  },
  // Advertising
  {
    id: "google-ads",
    label: "Google Ads",
    category: "Advertising",
    audience: "user",
    description: "Campaigns, spend, and performance in Google Ads.",
    transport: "stdio",
    template: STDIO("google-ads"),
    credential: { label: "Google Ads access token", envVar: "GOOGLE_ADS_TOKEN" },
    homepage: "https://ads.google.com",
  },
  {
    id: "meta-ads",
    label: "Meta Ads",
    category: "Advertising",
    audience: "user",
    description: "Facebook and Instagram ad campaigns and metrics.",
    transport: "stdio",
    template: STDIO("meta-ads"),
    credential: { label: "Meta access token", envVar: "META_ACCESS_TOKEN" },
    homepage: "https://business.facebook.com",
  },
  {
    id: "tiktok-ads",
    label: "TikTok Ads",
    category: "Advertising",
    audience: "user",
    description: "TikTok ad campaigns and performance.",
    transport: "stdio",
    template: STDIO("tiktok-ads"),
    credential: { label: "TikTok access token", envVar: "TIKTOK_ACCESS_TOKEN" },
    homepage: "https://ads.tiktok.com",
  },
  {
    id: "pinterest-ads",
    label: "Pinterest Ads",
    category: "Advertising",
    audience: "user",
    description: "Pinterest ad campaigns and analytics.",
    transport: "stdio",
    template: STDIO("pinterest-ads"),
    credential: { label: "Pinterest access token", envVar: "PINTEREST_ACCESS_TOKEN" },
    homepage: "https://ads.pinterest.com",
  },
  {
    id: "reddit-ads",
    label: "Reddit Ads",
    category: "Advertising",
    audience: "user",
    description: "Reddit ad campaigns and performance.",
    transport: "stdio",
    template: STDIO("reddit-ads"),
    credential: { label: "Reddit access token", envVar: "REDDIT_ACCESS_TOKEN" },
    homepage: "https://ads.reddit.com",
  },
  {
    id: "stackadapt",
    label: "StackAdapt",
    category: "Advertising",
    audience: "user",
    description: "Programmatic ad campaigns and reporting in StackAdapt.",
    transport: "stdio",
    template: STDIO("stackadapt"),
    credential: { label: "StackAdapt API token", envVar: "STACKADAPT_API_TOKEN" },
    homepage: "https://www.stackadapt.com",
  },
  {
    id: "linkedin-ads",
    label: "LinkedIn Ads",
    category: "Advertising",
    audience: "user",
    description: "LinkedIn ad campaigns and performance.",
    transport: "stdio",
    template: STDIO("linkedin-ads"),
    credential: { label: "LinkedIn access token", envVar: "LINKEDIN_ACCESS_TOKEN" },
    homepage: "https://business.linkedin.com/marketing-solutions/ads",
  },
  {
    id: "microsoft-ads",
    label: "Microsoft Advertising (Bing Ads)",
    category: "Advertising",
    audience: "user",
    description: "Bing and Microsoft Search Network ad campaigns and performance.",
    transport: "stdio",
    template: STDIO("microsoft-ads"),
    credential: { label: "Microsoft access token", envVar: "MS_ACCESS_TOKEN" },
    homepage: "https://ads.microsoft.com",
  },
  // Social
  {
    id: "meta-business",
    label: "Meta Business pages",
    category: "Social",
    audience: "user",
    description: "Facebook and Instagram business pages, posts, and insights.",
    transport: "stdio",
    template: STDIO("meta-business"),
    credential: { label: "Meta access token", envVar: "META_ACCESS_TOKEN" },
    homepage: "https://business.facebook.com",
  },
  {
    id: "linkedin-pages",
    label: "LinkedIn Pages",
    category: "Social",
    audience: "user",
    description: "Organic LinkedIn company pages, posts, and follower analytics.",
    transport: "stdio",
    template: STDIO("linkedin-pages"),
    credential: { label: "LinkedIn access token", envVar: "LINKEDIN_ACCESS_TOKEN" },
    homepage: "https://www.linkedin.com/company",
  },

  // ---- Developer only ------------------------------------------------------
  // Code hosting
  {
    id: "github",
    label: "GitHub",
    category: "Code hosting",
    audience: "developer",
    description: "Repositories, issues, and pull requests on GitHub.",
    transport: "stdio",
    template: STDIO("github"),
    credential: { label: "GitHub token", envVar: "GITHUB_PERSONAL_ACCESS_TOKEN" },
    homepage: "https://github.com",
  },
  {
    id: "gitlab",
    label: "GitLab",
    category: "Code hosting",
    audience: "developer",
    description: "Projects, issues, and merge requests on GitLab.",
    transport: "stdio",
    template: STDIO("gitlab"),
    credential: { label: "GitLab token", envVar: "GITLAB_TOKEN" },
    homepage: "https://gitlab.com",
  },
  {
    id: "bitbucket",
    label: "Bitbucket",
    category: "Code hosting",
    audience: "developer",
    description: "Repositories and pull requests on Bitbucket Cloud.",
    transport: "stdio",
    template: STDIO("bitbucket"),
    credential: { label: "Bitbucket app password", envVar: "BITBUCKET_TOKEN" },
    homepage: "https://bitbucket.org",
  },
  // Dev issues & PM
  {
    id: "jira",
    label: "Jira",
    category: "Dev issues & PM",
    audience: "developer",
    description: "Issues, sprints, and boards in Jira.",
    transport: "stdio",
    template: STDIO("jira"),
    credential: { label: "Atlassian API token", envVar: "ATLASSIAN_API_TOKEN" },
    homepage: "https://www.atlassian.com/software/jira",
  },
  {
    id: "linear",
    label: "Linear",
    category: "Dev issues & PM",
    audience: "developer",
    description: "Issues and projects in Linear.",
    transport: "stdio",
    template: STDIO("linear"),
    credential: { label: "Linear API key", envVar: "LINEAR_API_KEY" },
    homepage: "https://linear.app",
  },
  {
    id: "sentry",
    label: "Sentry",
    category: "Dev issues & PM",
    audience: "developer",
    description: "Errors, issues, and releases in Sentry.",
    transport: "stdio",
    template: STDIO("sentry"),
    credential: { label: "Sentry auth token", envVar: "SENTRY_AUTH_TOKEN" },
    homepage: "https://sentry.io",
  },
  // Databases
  {
    id: "postgres",
    label: "PostgreSQL",
    category: "Databases",
    audience: "developer",
    description: "Query a PostgreSQL database.",
    transport: "stdio",
    template: STDIO("postgres"),
    credential: { label: "Connection string", envVar: "DATABASE_URL" },
    homepage: "https://www.postgresql.org",
  },
  {
    id: "mysql",
    label: "MySQL",
    category: "Databases",
    audience: "developer",
    description: "Query a MySQL database.",
    transport: "stdio",
    template: STDIO("mysql"),
    credential: { label: "Connection string", envVar: "DATABASE_URL" },
    homepage: "https://www.mysql.com",
  },
  {
    id: "sqlite",
    label: "SQLite",
    category: "Databases",
    audience: "developer",
    description: "Query a local SQLite database file.",
    transport: "stdio",
    template: STDIO("sqlite"),
    homepage: "https://www.sqlite.org",
  },
  {
    id: "mongodb",
    label: "MongoDB",
    category: "Databases",
    audience: "developer",
    description: "Query a MongoDB database.",
    transport: "stdio",
    template: STDIO("mongodb"),
    credential: { label: "Connection string", envVar: "MONGODB_URI" },
    homepage: "https://www.mongodb.com",
  },
  {
    id: "redis",
    label: "Redis",
    category: "Databases",
    audience: "developer",
    description: "Inspect and query a Redis instance.",
    transport: "stdio",
    template: STDIO("redis"),
    credential: { label: "Connection string", envVar: "REDIS_URL" },
    homepage: "https://redis.io",
  },
  {
    id: "supabase",
    label: "Supabase",
    category: "Databases",
    audience: "developer",
    description: "Postgres, auth, and storage on Supabase.",
    transport: "stdio",
    template: STDIO("supabase"),
    credential: { label: "Supabase access token", envVar: "SUPABASE_ACCESS_TOKEN" },
    homepage: "https://supabase.com",
  },
  // Infra & cloud
  {
    id: "aws",
    label: "AWS",
    category: "Infra & cloud",
    audience: "developer",
    description: "Amazon Web Services resources and APIs.",
    transport: "stdio",
    template: STDIO("aws"),
    credential: { label: "AWS access key", envVar: "AWS_ACCESS_KEY_ID" },
    homepage: "https://aws.amazon.com",
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    category: "Infra & cloud",
    audience: "developer",
    description: "DNS, Workers, and account resources on Cloudflare.",
    transport: "stdio",
    template: STDIO("cloudflare"),
    credential: { label: "Cloudflare API token", envVar: "CLOUDFLARE_API_TOKEN" },
    homepage: "https://www.cloudflare.com",
  },
  {
    id: "docker",
    label: "Docker",
    category: "Infra & cloud",
    audience: "developer",
    description: "Inspect and manage local Docker containers and images.",
    transport: "stdio",
    template: STDIO("docker"),
    homepage: "https://www.docker.com",
  },
  {
    id: "kubernetes",
    label: "Kubernetes",
    category: "Infra & cloud",
    audience: "developer",
    description: "Inspect a Kubernetes cluster via kubeconfig.",
    transport: "stdio",
    template: STDIO("kubernetes"),
    homepage: "https://kubernetes.io",
  },
  {
    id: "vercel",
    label: "Vercel",
    category: "Infra & cloud",
    audience: "developer",
    description: "Deployments and projects on Vercel.",
    transport: "stdio",
    template: STDIO("vercel"),
    credential: { label: "Vercel token", envVar: "VERCEL_TOKEN" },
    homepage: "https://vercel.com",
  },
  {
    id: "netlify",
    label: "Netlify",
    category: "Infra & cloud",
    audience: "developer",
    description: "Sites and deploys on Netlify.",
    transport: "stdio",
    template: STDIO("netlify"),
    credential: { label: "Netlify token", envVar: "NETLIFY_AUTH_TOKEN" },
    homepage: "https://www.netlify.com",
  },
  // Observability
  {
    id: "datadog",
    label: "Datadog",
    category: "Observability",
    audience: "developer",
    description: "Metrics, monitors, and logs in Datadog.",
    transport: "stdio",
    template: STDIO("datadog"),
    credential: { label: "Datadog API key", envVar: "DD_API_KEY" },
    homepage: "https://www.datadoghq.com",
  },
  {
    id: "grafana",
    label: "Grafana",
    category: "Observability",
    audience: "developer",
    description: "Dashboards and data sources in Grafana.",
    transport: "stdio",
    template: STDIO("grafana"),
    credential: { label: "Grafana API token", envVar: "GRAFANA_API_KEY" },
    homepage: "https://grafana.com",
  },
  // CI/CD
  {
    id: "github-actions",
    label: "GitHub Actions",
    category: "CI/CD",
    audience: "developer",
    description: "Workflow runs and logs in GitHub Actions.",
    transport: "stdio",
    template: STDIO("github-actions"),
    credential: { label: "GitHub token", envVar: "GITHUB_PERSONAL_ACCESS_TOKEN" },
    homepage: "https://github.com/features/actions",
  },
  {
    id: "circleci",
    label: "CircleCI",
    category: "CI/CD",
    audience: "developer",
    description: "Pipelines and build status on CircleCI.",
    transport: "stdio",
    template: STDIO("circleci"),
    credential: { label: "CircleCI API token", envVar: "CIRCLECI_TOKEN" },
    homepage: "https://circleci.com",
  },
];

// The catalog visible to a given mode. Developer sees everything; user sees only
// user-audience entries. Absent audience (future callers) defaults to developer
// so nothing is accidentally hidden from the full view.
export function catalogForAudience(audience?: ConnectorAudience): ConnectorCatalogEntry[] {
  if (audience === "user") {
    return CONNECTOR_CATALOG.filter((entry) => entry.audience === "user");
  }
  return CONNECTOR_CATALOG;
}

// Group catalog entries by category, preserving first-seen category order.
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
