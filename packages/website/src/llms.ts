import { getAlternativePages } from "~/data/alternative-pages";
import { AGENT_PAGES } from "~/data/agent-pages";
import { type Doc, getDocs } from "~/docs";

const SITE_URL = "https://otto-code.me";

const PRODUCT_PREAMBLE = `# Otto

> A fully featured, self-hosted agentic coding assistant that brings frontier-model tooling to every provider — cloud and local alike — and lets you drive it from desktop, phone, browser, or terminal.

Otto is an open source application that runs AI coding agents on your own machine inside a rich, familiar environment: browser-verified previews, AI-generated artifacts, split panes with terminals and diffs, rich permission modes, and MCP integration. The tooling a frontier harness gives its own model works the same in Otto whether the agent is Claude Code, Codex, or a local model served from LM Studio or Ollama. Your code stays local — Otto connects directly to your real development environment instead of running agents in someone else's cloud.

A self-hosted daemon manages agent lifecycle, exposes a WebSocket API, and ships with an MCP server so other agents can talk to it. Native apps for Android, Windows, and Linux — plus a web app that covers iPhone and Mac — let you launch sessions, watch them work, review diffs, and ship from anywhere. A Docker-style CLI ("otto run", "otto ls", "otto logs", "otto wait") gives you scripting access. An end-to-end encrypted relay lets the mobile app reach your daemon over the public internet without exposing it.

Otto supports every major coding agent: Claude Code, Codex, GitHub Copilot, OpenCode, Cursor, Gemini, Cline, Goose, Amp, Aider, and 30+ others. Each agent runs as its own process; Otto handles I/O, persistence, git worktree isolation, schedules, and skills.

Distribution: native apps for macOS, Windows, Linux, and Android (APK); web app for everything else, including iPhone. macOS builds are unsigned — no Apple Developer account — so they need a Gatekeeper bypass on first launch and do not auto-update. No native iOS build for the same reason. Source: AGPL-3.0 at https://github.com/Draek2077/otto-code. Marketing site: https://otto-code.me.
`;

function docLine(doc: Doc): string {
  const url = `${SITE_URL}${doc.href}.md`;
  const description = doc.frontmatter.description?.trim();
  const suffix = description ? `: ${description}` : "";
  return `- [${doc.frontmatter.title}](${url})${suffix}`;
}

function agentLine(agent: (typeof AGENT_PAGES)[number]): string {
  return `- [${agent.name}](${SITE_URL}/${agent.slug}): ${agent.subtitle}`;
}

function alternativeLine(page: ReturnType<typeof getAlternativePages>[number]): string {
  const description = page.description.trim();
  const suffix = description ? `: ${description}` : "";
  return `- [${page.title}](${SITE_URL}${page.href})${suffix}`;
}

function topLevelDocs(): Doc[] {
  return getDocs().filter((d) => !d.slug.includes("/"));
}

export function buildLlmsTxt(): string {
  const docs = topLevelDocs().map(docLine).join("\n");
  const alternatives = getAlternativePages().map(alternativeLine).join("\n");
  const agents = AGENT_PAGES.map(agentLine).join("\n");

  return `${PRODUCT_PREAMBLE}
## Docs

${docs}

## Alternatives

${alternatives}

## Supported agents

${agents}

## Optional

- [Changelog](${SITE_URL}/changelog): Release notes for the Otto daemon, CLI, desktop, and mobile apps.
- [Download](${SITE_URL}/download): Install Otto on Mac, Windows, Linux, iOS, Android, or run the web app.
- [Otto Cloud](${SITE_URL}/cloud): Waitlist for the hosted multi-user version of Otto.
- [Blog](${SITE_URL}/blog): Updates and technical posts from the Otto team.
- [Privacy](${SITE_URL}/privacy): Privacy policy.
- [Security](${SITE_URL}/security): Security policy and responsibility disclaimer.
- [GitHub](https://github.com/Draek2077/otto-code): Source code, issues, and releases.
`;
}
