# Web Search Providers — charter

Status: **not started** (research notes only). Separate effort from the speech/TTS settings work; captured here so the findings don't get lost.

## What this is

Make the engine behind the daemon's built-in `web_search` tool selectable, starting with free, zero-configuration engines (no API keys, no accounts). Today it is hardcoded to DuckDuckGo.

## Scope decision (already made)

The built-in `web_search` tool is **only used by the natively-tooled OpenAI-compatible provider**. Every other agent provider (Claude Code, Codex, Copilot, OpenCode, Pi) ships its own web-search tooling inside its own harness — Otto neither routes nor controls those.

Therefore:

- The engine picker belongs in the **OpenAI-Compatible provider settings panel**, not the general host **Agents** section and not a new settings section. Surfacing it as a host-wide "web search" setting would imply it affects all agents, which is false.
- Engine candidates are limited to **free, no-configuration** options for now. Anything requiring an API key (Brave Search API, Tavily, Serper, Bing) is out of scope until a later phase.

## Current implementation (as of 2026-07)

All in `packages/server/src/server/agent/providers/openai-compat-tools.ts` (daemon-executed tool suite for the openai-compat provider):

- **Two-tier DuckDuckGo strategy**: Instant Answer API (`https://api.duckduckgo.com`) plus HTML scraping fallback (`https://html.duckduckgo.com/html/`).
- `parseDdgHtmlResults()` parses both the current div-based DDG markup and the legacy `<li class="result">` markup, unwraps `uddg=` redirect URLs (preserving query params), and strips tags from titles/snippets. Tests live in `openai-compat-agent.test.ts` ("DDG result parsing …").
- Constants: `WEB_SEARCH_TIMEOUT_MS = 15_000`, `MAX_WEB_SEARCH_RESULTS = 15`.
- `ALLOWED_HOSTS` allowlists exactly the two DDG hosts — this is part of the SSRF hardening shared with `web_fetch` (which blocks private/reserved IP ranges). **Any new engine's endpoints must be added to this allowlist deliberately; do not loosen the general fetch rules instead.**
- The tool description surfaced to the model currently says "Search the web using DuckDuckGo" — it should describe the selected engine (or go engine-neutral) once selectable.

Enablement is per-agent, not per-daemon: `webSearch?: boolean` on agent config (`packages/protocol/src/agent-types.ts`), set from the create-agent form's tool category toggles, and forwarded to subagents in `otto-tools.ts`. The engine choice would be a **provider-level runtime setting**; the per-agent boolean stays as-is.

## Where the setting would live

- **Daemon**: the OpenAI-compat provider's runtime settings (persisted config `agents.providers` map, `AgentProviderRuntimeSettingsMap` in `packages/server/src/server/persisted-config.ts`). New optional field, e.g. `webSearchEngine`, defaulting to `duckduckgo` — protocol-compatible by construction (`.optional()` with default).
- **Client**: the provider settings panel (`packages/app/src/components/provider-settings-host.tsx`, definitions in `packages/app/src/utils/provider-definitions.ts`), rendered as a dropdown even while there are only two options — more engines will come later.
- **Hot reload**: expected to be trivial. The engine is just a fetch target read at tool-execution time; unlike the speech runtime there are no long-lived native resources to reconcile. Verify how provider runtime settings propagate to in-flight agents (likely next-tool-call pickup is fine and acceptable).

## Candidate engines (unverified — research needed)

Each needs verification that it is scrapeable/usable without a key, tolerant of server-side requests, and stable enough to commit markup parsing to:

- **DuckDuckGo** — current default; keep.
- **Mojeek** — independent index, has a plain HTML results page; historically scraping-tolerant. Verify ToS + markup stability.
- **Startpage** — Google results via privacy proxy; known to be aggressive with bot detection. Probably a poor fit; verify before including.
- **Marginalia Search** — non-commercial index with a genuinely free API tier; niche result quality (favors small/old web) but philosophically aligned. Verify current API status.
- **SearXNG public instances** — free meta-search with a JSON API, but public instances are volatile and rate-limited; better as a "custom instance URL" option later (that drifts toward "configuration", so likely phase 2).
- **Brave/Tavily/Bing/Serper** — explicitly deferred; all require keys.

Research task before any implementation: pick the 1–2 engines that actually survive scrutiny; several of the above will likely fall out.

## Design constraints to carry over

- One `SearchEngine` interface (`search(query) → results[]`) with per-engine implementations; the tool handler stays engine-agnostic. Mirrors the `TextToSpeechProvider` shape used by the speech subsystem.
- Keep the result contract identical across engines (title, url, snippet) so the model-facing tool output doesn't vary by engine.
- Per-engine host allowlist entries, per-engine markup parsers with the same test discipline the DDG parser has (current + legacy markup fixtures).
- Engine failures should fall back loudly (error outcome naming the engine), not silently cascade to another engine — silent fallback hides breakage of the user's chosen engine.
