# Outreach — getting Otto known

**Status:** charter, approved to plan · **Opened:** 2026-07-19 · **Owner:** Draekz (maker voice)

Otto is free, open source (AGPL-3.0), self-hosted, sells nothing, and collects nothing. The entire
goal of this project is **awareness**: that a developer who would love Otto can find out it exists.
No funnel, no conversion target, no revenue. The only success metric that matters is _people who
would want this, know about this_.

This charter is the strategy. The operational detail lives in four sibling files:

| File                       | What's in it                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| [channels.md](channels.md) | The channel dossier — every target, its verified rules, gates, cadence caps, and confidence level |
| [pipeline.md](pipeline.md) | The AI automation architecture — what the machine does, what it must never do, and why            |
| [content.md](content.md)   | Message house, asset library, editorial calendar, the per-channel copy shapes                     |
| [runbook.md](runbook.md)   | Per-send checklist, guardrails, shadowban checks, incident response                               |

---

## 1. The three decisions that shape everything

Settled 2026-07-19 before planning began.

**Voice: the maker, first person, under Draekz.** Not a project account. Every channel that matters
for this category — Hacker News, r/LocalLLaMA, r/selfhosted, Lobsters, Fosstodon — rewards a person
and punishes a brand. HN's own guideline is explicit that "HN is a community—users should have an
identity that others can relate to." A branded account posting product copy reads as astroturf in
exactly the rooms we need. The fork-of-Paseo relationship also only reads as honest when a human
says it.

**Automation: draft queue, human send.** The AI does discovery, research, drafting, asset
generation, scheduling, compliance-checking and measurement — everything except pressing send and
except live conversation. This is not a compromise imposed by caution; §4 shows it is the only
architecture that survives 2026 platform enforcement, and the parts it forbids are precisely the
parts that determine whether a post succeeds.

**Timing: gated launch.** Nothing ships outward until Phase 0 exits. Outreach that lands on a thin
page converts once and never again, and most of these channels are one-shot — you do not get to
re-post to r/selfhosted in three months because the demo video wasn't ready the first time.

---

## 2. What the research changed

Three findings from the 2026-07-19 landscape sweep overturned the obvious plan. They are the reason
this charter is not "post it on Reddit and Hacker News."

### 2a. The mobile pitch is no longer a differentiator

- **2026-02-24** — Anthropic shipped [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control):
  continue a local session from phone or browser via claude.ai. First-party, free, zero setup.
- **2026-04** — Cline shipped mobile ("how to vibe code from your phone") and, in March, Kanban, a
  CLI-agnostic multi-agent orchestrator.

"Drive your local agents from your phone" was Otto's headline. As of five months ago it is table
stakes, offered first-party by the largest vendor in the category. **Leading with mobile in July 2026
invites the reply "Claude already does this."** Positioning must move (§3).

### 2b. Provider parity is the actual wedge, and nobody else claims it

The fork's founding mission — frontier-harness tooling for every provider, cloud and local alike — is
a claim no competitor makes. Cline, OpenCode, Zed, Kilo all support many models; none give a local
LM Studio model the _same harness_ the frontier vendor gives its own: browser-verified preview,
observed subagents, MCP, compaction, artifacts, permission modes.

That claim is **demonstrable, filmable, and benchmarkable in a single 40-second clip**: the same
agent loop, same preview verification, running against Claude and then against a local model, side
by side. That clip is the single most valuable asset this project produces.

### 2c. The category rewards permanence, not launch spikes

Every 2026 source points the same direction: away from single-day launch events, toward permanent
directory presence and sustained visible shipping.

- **awesome-selfhosted** (306,751 stars, **zero open issues**, pushed 2026-07-19) has a category
  `Software Development - IDE & Tools` containing Atheos, code-server, Coder, Eclipse Che, Judge0,
  JupyterLab, Langfuse, LiveCodes, Lowdefy, RapidForge, RStudio Server. **There is no AI coding agent
  or agentic IDE in it.** Neither does the GenAI category have one. AGPL is explicitly fine (Coder,
  RStudio Server, Khoj are all AGPL-3.0). This is a genuine, unclaimed gap in the single
  best-maintained directory in self-hosting.
- **Cline's** growth came from repeatedly making the vendor-independence argument in essays, with the
  product as proof — not from launches. That strategy costs writing, not money, which is exactly what
  a solo maker has.
- **OpenCode** went 0 → 187K stars with **no launch campaign at all** (debuted to ~30 people at a
  Toronto meetup). Its inflection was Anthropic blocking it on 2026-01-09 — ~18,000 stars in two
  weeks — because it was the neutral option when a vendor tightened the screws. Founder Jay V:
  _"OpenCode is not an AI product. It's a product designed to use AI… we're not betting on any single
  model or provider winning."_ That is Otto's thesis nearly verbatim.
- **Aider** (47.5K stars, last push 2026-05-22) and **Void** (28.9K, 2026-06-02) both stalled. Both
  will be dropped from directories: awesome-selfhosted removes projects inactive 6–12 months,
  daily.dev drops sources inactive 3+ months. **Directory listings are only durable if commits are.
  Visible shipping is itself a distribution channel.**

### 2d. The cold-start reality — verified 2026-07-19, and it governs everything

| Fact                              | Value                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `Draek2077/otto-code` made public | **2026-07-05 — 14 days ago**                                                        |
| Stars / forks / watchers          | **1 / 1 / 0**                                                                       |
| First public release              | **v0.3.2, 2026-07-05**                                                              |
| Releases since                    | ~20, current v0.6.3 (2026-07-18) — shipping hard                                    |
| GitHub-detected license           | was **`NOASSERTION`** — fixed 2026-07-19 (Phase 0.11); GitHub re-scans on next push |

Otto the product is mature. **Otto the public repository is two weeks old with one star**, and a
large share of the channels in this plan gate on repository age, release age, or star count. This is
not a footnote — it re-orders the entire plan:

| Channel                                                                                                                                                                                                               | Gate                                                                             | Otto eligible          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------- |
| **awesome-selfhosted**                                                                                                                                                                                                | first release >4 months old                                                      | **~2026-11-05**        |
| **Homebrew** (self-submit)                                                                                                                                                                                            | 90 forks / 90 watchers / **225 stars**, repo >30 days                            | blocked                |
| **Coolify** one-click                                                                                                                                                                                                 | **1,000 stars**                                                                  | blocked                |
| **Scoop main bucket**                                                                                                                                                                                                 | 500 stars + 150 forks (Extras has no gate)                                       | blocked → use Extras   |
| **AlternativeTo**                                                                                                                                                                                                     | account must be **1 week old** before first submission                           | create the account now |
| **Lobsters**                                                                                                                                                                                                          | new users cannot submit a domain the site hasn't seen; no `show` tag for 70 days | blocked                |
| **awesome-ai-devtools**, **awesome-cli-coding-agents**, **awesome-local-llm**, **selfh.st**, **LibHunt**, **SaaSHub**, **Dev Hunt**, **Peerlist**, Changelog News, console.dev, TLDR, Obtainium, AUR, winget, Flathub | none                                                                             | **now**                |

Two consequences. First, **Phase 1 is smaller than it looks and needs an eligibility calendar with
tripwires** (§6). Second, and more important: the gates are all proxies for _audience_, and Otto has
none. The honest read of the case studies is that **every project that inflected already had a
distribution surface** — OpenCode had SST/Dax's following, Cline had the VS Code Marketplace, Aider
had a leaderboard the entire industry had to cite. **No clean solo-maker-from-zero case study exists.**
Expectations calibrated on 187K-star outcomes are miscalibrated.

That is precisely why §6 Phase 4 exists: the one lever available to a project with no audience is to
**build an artifact other people need to cite.**

**Conclusion: the plan is a permanence strategy, plus one citable artifact, with one big swing held
in reserve** — not a launch.

---

## 3. Positioning

### The one-line claim

> **Otto gives a local model the same harness a frontier vendor gives its own.**
> Open source, self-hosted, any provider, on your machine.

### Message house

| Pillar                     | Claim                                                                                                         | Proof we can show                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Parity** _(lead)_        | Browser-verified preview, observed subagents, MCP, compaction, artifacts — for LM Studio, not just for Claude | The side-by-side clip; `docs/preview.md`; the openai-compat native tool loop                 |
| **Neutrality**             | Six built-in providers plus any OpenAI-compatible endpoint. Switch when the landscape shifts.                 | Provider list; the ACP catalog; one workspace running two providers in split panes           |
| **Sovereignty**            | Your machine, your keys, your code. No telemetry, no account, no cloud dependency, no inference markup.       | AGPL repo; daemon architecture; `SECURITY.md`; the fact that there is nothing to sign up for |
| **A named cast**           | Personalities and teams — agents with roles, colors, voices, spawnable by other agents                        | The personalities demo scenario                                                              |
| **Everywhere** _(support)_ | Desktop, phone, web, CLI, remote daemon                                                                       | Mobile screenshots — **demoted from headline to supporting detail** per §2a                  |

### Things we must say precisely

- **"Otto is a fork of [Paseo](https://github.com/getpaseo/paseo)."** Say it first, every time,
  unprompted. Paseo is at 10,864 stars and actively maintained; its community overlaps ours
  completely. Led with, the fork relationship is a credibility asset and a courtesy. Discovered
  later, it is a scandal. The site already does this well ("proudly forked from Paseo") — the same
  discipline applies to every post, DM, and pitch.
- **How Otto talks to Claude.** Otto drives the user's own official Claude Code CLI / Agent SDK with
  their own credentials. It does **not** reuse or spoof OAuth tokens. Anthropic clarified in
  February 2026 that using Claude Free/Pro/Max OAuth tokens in third-party products is not
  permitted, and enforced it. This is a well-informed audience that will check, and getting the
  wording sloppy invites a hostile thread from people who watched OpenCode get blocked. See
  [runbook.md](runbook.md) for the approved phrasing.
- **What Otto does not have.** No macOS build (no Apple hardware), no iOS build, Play is
  internal-track only. State it up front in every post. Volunteering the gap defuses it; being caught
  omitting it costs the thread.

### Anti-positioning — what we never say

Not "the best." Not "Cursor killer." Not a feature-list dump. Never a comparison that disparages
Paseo, Cline, OpenCode, or Zed — we are asking to stand in their communities. Never "vibe coding" as
our own descriptor: Lobsters built a `vibecoding` tag specifically so members can _filter it out_,
and the phrase reads as marketing to the exact senior audience we want. Use it only to describe the
category when someone else raised it.

---

## 4. The automation boundary — and why "fully automated" is the wrong target

The ask was a strategy "fully automated by AI." Here is the honest engineering answer: **roughly 80%
of the work automates cleanly and legally, and the remaining 20% is both prohibited and
outcome-determining.** A system that automates the last 20% does not perform 20% better — it gets the
domain banned.

### Hard prohibitions, verbatim

| Source                                                                                                                                  | Rule                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [HN guidelines](https://news.ycombinator.com/newsguidelines.html)                                                                       | **"Don't post generated text or AI-edited text. HN is for conversation between humans."** — note **AI-_edited_**: running your own draft through a model for polish is inside the prohibition |
| [Reddit](https://support.reddithelp.com/hc/en-us/articles/41180423371156-Manipulated-Content-and-Misleading-Behavior) (upd. 2026-05-19) | AI content allowed **only if disclosed**: prohibits content "that presents itself as human-generated"; "be transparent and include a tag"                                                     |
| [Reddit spam policy](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam) (upd. 2026-05-19)                              | Never allowed: "Using tools (e.g., bots, generative AI tools) that may break Reddit or facilitate the proliferation of spam"                                                                  |
| [HN guidelines](https://news.ycombinator.com/newsguidelines.html)                                                                       | "Please don't use HN primarily for promotion… the primary use of the site should be for curiosity."                                                                                           |
| [Bluesky dev guidelines](https://docs.bsky.app/docs/support/developer-guidelines)                                                       | Prohibited: "Generating automated or bulk interactions, including any that would cause a notification to a user"                                                                              |
| [X developer guidelines](https://docs.x.com/developer-guidelines)                                                                       | Automated replies only where "the user engaged first," max one reply per interaction                                                                                                          |
| [Fosstodon rules](https://fosstodon.org/api/v1/instance)                                                                                | "DO NOT use automated tools to post without also monitoring and/or interacting from your account."                                                                                            |
| [sindresorhus/awesome](https://github.com/sindresorhus/awesome)                                                                         | "Fully AI-generated pull requests are not accepted."                                                                                                                                          |
| [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)                                                              | "resource recommendations must be created by human beings" — and PRs instead of the issue form risk repo restriction                                                                          |
| [daily.dev](https://docs.daily.dev)                                                                                                     | Rejects "AI-generated content… or content with characteristics typical of AI-generated material"                                                                                              |
| [Dev.to CoC](https://dev.to/code-of-conduct)                                                                                            | Requires **disclosing AI assistance** used to create content                                                                                                                                  |
| [Product Hunt](https://help.producthunt.com/en/articles/3615694-community-guidelines)                                                   | "using bots… any other form of artificially increasing activity" → permanent removal                                                                                                          |

Also structural: **Hacker News, Lobsters, and Product Hunt launches have no write API at all.** There
is nothing to automate even if it were permitted.

### Enforcement is velocity-shaped, not intent-shaped

Reddit's [March 2026 human-verification rollout](https://techcrunch.com/2026/03/25/reddit-bots-new-human-verification-requirements/)
fires on account signals explicitly including **"how quickly the account is attempting to write or
post content."** A queue where a human approves twenty items and fires them in ten minutes is _more_
dangerous than no automation — the human click is invisible to the classifier; the timing
distribution is not. Reddit also now offers an `[App]` label for registered automated accounts;
unlabeled automation is the thing being hunted.

The fatal signature across every platform is the same, and it is not "used AI":

1. One domain, many accounts _(strongest astroturf signal on both HN and Reddit)_
2. Reply velocity that is machine-shaped
3. Topical monomania — an account whose whole history is one project
4. Templated phrasing that moderators pattern-match across a sub
5. Answering questions with your product daily instead of weekly

### The resulting split

| The machine owns (fully automated)                                                      | The human owns (never automated)                                |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Watching HN/GitHub/RSS/Bluesky for relevant threads                                     | Pressing send, anywhere                                         |
| Maintaining the channel dossier and flagging stale rules                                | Every reply in a live thread (HN especially — never AI-written) |
| Drafting channel-shaped copy from the message house                                     | The Show HN submission and its first-hour comments              |
| Generating and versioning demo assets (clips, screenshots, OG cards)                    | Discord participation                                           |
| Enforcing cadence caps, give:take ratio, send jitter                                    | Anything that requires judgment about a specific person         |
| Compliance-checking each draft against that channel's rules before it reaches the queue | Reading a subreddit's actual sidebar (§6, Phase 0)              |
| Daily measurement snapshots, shadowban checks, attribution                              | Deciding when to spend the one Show HN                          |

**The queue is not a send button. It is a rate governor and a give:take ledger.** That is the single
most important architectural decision in [pipeline.md](pipeline.md).

### Where this lands as a capability

The pipeline is a real, buildable system that does the tedious 80% autonomously and hands over a
reviewed, compliant, correctly-timed item. In practice that is 15 minutes of human attention per
week plus presence in threads we actually opened. It is more automation than any solo maker
currently runs, and it stays inside every ToS on the list.

**Dogfooding note:** Otto already has scheduled agents, MCP, personalities, and artifacts. The
recommended implementation is that **Otto runs its own outreach** — a "Herald" personality on a cron,
producing the review queue as an artifact. That is both the cheapest build and, itself, a story worth
telling. See [pipeline.md](pipeline.md) §6.

---

## 5. Separation — where this lives

Per the fork convention that the website is independent of the product, outreach is independent of
both.

- **Code:** `packages/outreach/` — a new workspace package. **Zero imports from `@otto-code/protocol`,
  `server`, `app`, `client`, or `visualizer`.** It must be extractable to its own repository with no
  changes beyond the workspace entry. It is a Node CLI plus a static review page; it does not touch
  the daemon, and no outreach code ever ships inside the app, the daemon, or a release artifact.
- **Content:** `packages/website/posts/` for the blog (the system exists and is empty), plus a new
  `/press` route and the `/go` redirector in `packages/website`. These are website concerns and
  belong there.
- **Plans and dossiers:** this folder, `projects/outreach/`.
- **Secrets:** never in the repo. Local `.env` for the maker's machine; if a scheduled job is used,
  GitHub environment secrets with required reviewers.

When this project ships, fold the durable facts into a new `docs/outreach.md` and delete the folder,
per the CLAUDE.md convention.

---

## 6. Phases

### Phase 0 — Readiness gate ⛔ nothing goes outward until every box is checked

The landing surface is what every channel points at. Today the blog has zero posts, the demo pipeline's
output is not wired into the site, and the sponsor link points at upstream's author.

| #    | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Where                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 0.1  | **Reposition the landing page** per §3 — parity as the headline, mobile demoted to a supporting section                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `packages/website/src/routes/index.tsx`      |
| 0.2  | **The parity clip.** 40s, same task, Claude then local LM Studio, both browser-verifying. The single most important asset in this project.                                                                                                                                                                                                                                                                                                                                                                                                                 | `packages/app/demo/` → `site-demos` pipeline |
| 0.3  | **Wire demo assets into the site.** The pipeline produces manifests; the site consumes none of them and still uses hand-built mockups and static `phone-*.png`.                                                                                                                                                                                                                                                                                                                                                                                            | `packages/website` ← `public/demos/`         |
| 0.4  | **Three blog posts published** (see [content.md](content.md) §3 for the specific three). The blog system works; it has never been used.                                                                                                                                                                                                                                                                                                                                                                                                                    | `packages/website/posts/`                    |
| 0.5  | **`/press` page** — one-paragraph and one-line descriptions, logo pack, the parity clip, screenshots, honest limitations, contact. Every pitch in Phase 1 and 5 links here.                                                                                                                                                                                                                                                                                                                                                                                | `packages/website/src/routes/press.tsx`      |
| 0.6  | **`/go` redirector** — `otto-code.me/go?c=<channel>` → 302. GitHub's traffic API reports hostnames only, so this is the _only_ way to attribute a click to a channel without telemetry.                                                                                                                                                                                                                                                                                                                                                                    | `packages/website`                           |
| 0.7  | **Measurement baseline running** — daily snapshot of GitHub traffic/referrers/stars/download counts. GitHub keeps traffic for **14 days only**; unsnapshotted data is gone forever.                                                                                                                                                                                                                                                                                                                                                                        | `packages/outreach/`                         |
| 0.8  | ~~Fix the sponsor link~~ **Done 2026-07-19, and the original diagnosis was wrong.** The website is deliberate and correct: `/sponsor` and the landing page both state Otto takes no sponsorships and route support to Paseo, with the upstream author named in surrounding copy. Only the **app** was misleading — a bare "Sponsor" button sitting between Otto's own Star and Feedback buttons, silently opening upstream's page. Relabelled to **"Sponsor Paseo"** with a comment recording why.                                                         | `packages/app` (website needed no change)    |
| 0.9  | **Read every target subreddit's sidebar by hand and fill in [channels.md](channels.md).** Reddit blocks automated reading entirely; every Reddit rule in the dossier is currently secondhand. ~20 minutes.                                                                                                                                                                                                                                                                                                                                                 | `projects/outreach/channels.md`              |
| 0.10 | ~~Verify the 4-month rule~~ **Done 2026-07-19:** first release v0.3.2 on 2026-07-05 → awesome-selfhosted eligible **2026-11-05**. Calendar it.                                                                                                                                                                                                                                                                                                                                                                                                             | —                                            |
| 0.11 | ~~Fix license detection~~ **Done 2026-07-19.** The 10-line Paseo/Boudra preamble moved out of `LICENSE` into `NOTICE`, preserved verbatim and with a note explaining the relocation. `LICENSE` is now byte-identical to the canonical AGPL-3.0 text from gnu.org (verified, 34,502 chars), so `licensee`/SPDX tooling will detect it. Also corrected two stale facts in `NOTICE` (`otto-code.ai` → `otto-code.me`; bundle IDs are `me.ottocode*` mobile / `ai.ottocode.desktop`). **Worth a human sanity-check — it touches upstream's copyright notice.** | `LICENSE`, `NOTICE`                          |
| 0.12 | ~~Add license field~~ **Done 2026-07-19.** Root already had one. Added `"license": "AGPL-3.0-or-later"` to the **nine** packages missing it — the six published (`protocol`, `client`, `server`, `cli`, `highlight`, `relay`) plus `visualizer`, `app`, `website`. `expo-two-way-audio` stays MIT (upstream's own library).                                                                                                                                                                                                                                | 9 × `packages/*/package.json`                |

**Exit criteria:** a stranger landing on otto-code.me from a cold link sees, within ten seconds, what
Otto is, watches it work, and can download it — and the dossier has no unverified rule for any Phase
1 or 3 channel.

### Phase 1 — Permanent surfaces (formal routes, zero etiquette risk)

Every item here is an official submission channel where self-submission is explicitly invited. No
community judgment, no ban risk, no timing games. **This is the highest value-per-risk work in the
project and it is mostly unclaimed.**

**Available now:**

| Priority | Target                                                                                                           | Why / criteria                                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**    | [jamesmurdza/awesome-ai-devtools](https://github.com/jamesmurdza/awesome-ai-devtools) PR                         | 3,892★, active. **No star, age, or license gate.** Has `AI-Native IDEs`, `Terminal Agents`, `Desktop & Mobile Applications`, `Multi-Agent Orchestration` — Otto fits several. Best value-per-effort available today. |
| **2**    | [selfh.st](https://selfh.st) — submission form at the bottom of each weekly issue                                | Self-Host Weekly is publishing (latest 2026-07-17). Human curator, exactly Otto's audience, free. ~20 min.                                                                                                           |
| **3**    | [changelog.com/news/submit](https://changelog.com/news/submit)                                                   | Verbatim: "submitting your own work" is encouraged. Zero risk. Also the on-ramp to a Changelog episode.                                                                                                              |
| **4**    | `hello@console.dev`                                                                                              | Their [selection criteria](https://console.dev/selection-criteria) read like Otto's spec sheet; the betas section takes pre-1.0. No sponsored reviews — winning it means something.                                  |
| **5**    | [Anthropic project form](https://form.typeform.com/to/VIUAjxNi)                                                  | Official "share projects for potential feature on Claude's social channels." Pure upside.                                                                                                                            |
| **6**    | [bradAGI/awesome-cli-coding-agents](https://github.com/bradAGI/awesome-cli-coding-agents)                        | 833★, the most on-topic list that exists. `packages/cli` satisfies its CLI requirement. 10-minute PR.                                                                                                                |
| **7**    | [rafska/awesome-local-llm](https://github.com/rafska/awesome-local-llm)                                          | 2,409★. Zero quality bar. The LM Studio/Ollama angle is the hook.                                                                                                                                                    |
| **8**    | **Create the AlternativeTo account** (submit ≥1 week later)                                                      | 1-week account age gate. The prize isn't Otto's page — it's appearing as an alternative on the Cursor / Claude Code / Zed pages.                                                                                     |
| 9        | `submissions@tldr.tech` (TLDR AI, TLDR Web Dev)                                                                  | 7.2M developers, free                                                                                                                                                                                                |
| 10       | [LibHunt](https://www.libhunt.com/repo/submit) · [SaaSHub](https://www.saashub.com/services/submit)              | 60-second submissions. SaaSHub: **list competitors or the submission goes to the back of the queue.** LibHunt auto-ingests any HN/Reddit/DEV mention afterwards.                                                     |
| 11       | [Dev Hunt](https://devhunt.org) · [Peerlist Launchpad](https://peerlist.io/launchpad)                            | Weekly cycles, dev-only audiences, free, low competition. Peerlist ranks on link clicks, which favors things people actually try.                                                                                    |
| 12       | [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) — **web issue form only, never a PR** | 50,417★. A PR "risks being restricted from interacting with this repository." Currently pausing recommendations — check first. Their own CONTRIBUTING warns that get-on-the-list-as-strategy usually fails.          |

**Gated — set tripwires, do not attempt early:**

| Target                 | Gate                                              | Earliest       |
| ---------------------- | ------------------------------------------------- | -------------- |
| **awesome-selfhosted** | First release >4 months old (v0.3.2 = 2026-07-05) | **2026-11-05** |
| Homebrew               | 225★ self-submission threshold                    | on stars       |
| Coolify one-click      | 1,000★                                            | on stars       |
| Scoop main bucket      | 500★ + 150 forks                                  | on stars       |

**awesome-selfhosted, when eligible, needs three specific things** (it is the highest-payoff single
listing, and it bans careless submissions): submit `software/otto.yml` to the **data** repo, never the
generated README; put `software-development---ide--tools` **first** in tags (single-page mode shows
only the first); append **`(fork of Paseo)`** per their fork rule; and pre-empt the disqualifier
_"software that is a desktop, mobile, or command-line application, which relies on a separate file
synchronisation/server program"_ by framing **the daemon as the self-hosted service** and Electron/Expo
as its clients. Their CONTRIBUTING also warns that "Machine/LLM-generated contributions, that do not
respect project guidelines are not allowed and **will result in a ban**."

**Deliberately skipped, with reasons:** `sindresorhus/awesome` (lists other _lists_, not projects — there is
no path to add Otto); `Shubhamsaboo/awesome-llm-apps` (hand-built in-repo apps, not a directory);
`punkpeye/awesome-mcp-servers` (2,919 contributors, ~2,844 open issues — and only Otto's MCP server
would qualify, not Otto); `modelcontextprotocol/servers` (closed to listings); `RunaCapital/awesome-oss-alternatives`
(requires being a for-profit company); `sourcegraph/awesome-code-ai` (archived); There's An AI For That
and Futurepedia (no free path — $49–$347, prompt-tourist audience).

### Phase 1b — Packaging is a discovery channel

Overlooked in the original framing and worth as much as any post: package managers and homelab app
stores are **browsable, indexed, permanently-listed surfaces with their own built-in traffic**. Every
one of these also lowers install friction, which is what actually converts a reader into a user.

| Target                                                                                            | Effort  | Notes                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Big Bear CasaOS](https://github.com/bigbeartechworld/big-bear-casaos)**                        | 0.5–1h  | **Best ROI here.** Forum post, not a PR — the maintainer packages it, and it ships alongside CasaOS/ZimaOS app stores.                                                                                                                                                                                                                                                                      |
| **[Flathub](https://docs.flathub.org/docs/for-app-authors/submission)**                           | 8–16h   | Highest-value desktop channel; default backend for GNOME Software and KDE Discover. Target the `new-pr` branch. **App ID must be `me.otto_code.Otto`** — dashes become underscores. No network during build → `flatpak-node-generator`. PR template requires a video and an authorship attestation. Disable electron-updater in this build.                                                 |
| **[Obtainium](https://github.com/ImranR98/apps.obtainium.imranr.dev)**                            | 1h      | **The real Android path.** Self-submitted PR, no licensing/AI/tracker gate. Needs APKs (not AAB) on GitHub Releases with stable arch-tagged names and a never-rotated signing key.                                                                                                                                                                                                          |
| **[winget](https://learn.microsoft.com/en-us/windows/package-manager/package/repository)**        | 3–5h    | The NSIS `.exe` qualifies. Automate afterwards with [winget-releaser](https://github.com/vedantmgoyal9/winget-releaser).                                                                                                                                                                                                                                                                    |
| **AUR**                                                                                           | 2–3h    | No notability gate; Google-indexed. Source the versioned `.tar.gz`/rpm — **not** the deliberately version-less AppImage.                                                                                                                                                                                                                                                                    |
| **[Unraid Community Apps](https://forums.unraid.net/topic/87144-ca-application-policies-notes/)** | 2–4h    | Strongest browse habit of any homelab store. Requires a permanent support thread and 2FA on the GitHub org.                                                                                                                                                                                                                                                                                 |
| **[Umbrel](https://github.com/getumbrel/umbrel-apps)**                                            | 4–8h    | amd64+arm64 already shipped. Forbids mounting the host Docker socket — see the caveat below.                                                                                                                                                                                                                                                                                                |
| **Snap** (classic confinement)                                                                    | 4–6h    | Classic confinement is explicitly allowed for IDEs. **Frame the store-request as "IDE," not "needs host access."** Publisher vetting at 1★ is a real gate — do after Flathub.                                                                                                                                                                                                               |
| Portainer templates (`v3` branch), Scoop Extras, nixpkgs, Chocolatey, Docker Hub DSOS             | 1–6h ea | Low individual value, cheap, fire-and-forget. DSOS qualifies Otto explicitly: "in active development with no pathway to commercialization."                                                                                                                                                                                                                                                 |
| **Skip: F-Droid and IzzyOnDroid**                                                                 | —       | F-Droid forbids GMS/Firebase (`expo-notifications`) and OTA executable delivery (`expo-updates`), has no committed `android/`, and would apply the _Non-Free Network Services_ anti-feature. IzzyOnDroid is "strongly opposed to apps which are fully or in part created by generative AI tools" and separately rejects apps for accessing big AI platforms. 40–80h for a likely rejection. |

**Positioning caveat for the homelab stores:** Otto's pitch is "your code stays on your machine," which
degrades badly inside a sandbox that only sees its own volume. Decide the story before submitting, and
make sure provider credential setup works from the web UI without SSHing into a container.

### Phase 2 — Build the pipeline

Full architecture in [pipeline.md](pipeline.md). Sequenced after Phase 1 because Phase 1 needs no
tooling and shouldn't wait for it.

### Phase 3 — Community presence (earn standing before spending it)

Ordered by permanence and inverse risk. **Forums before Discord** — a forum post is SEO-indexed and
permanent; a Discord message scrolls away in four minutes.

1. **Forums** — [community.openai.com](https://community.openai.com/) Codex category,
   [GitHub Copilot Conversations](https://github.com/orgs/community/discussions/categories/copilot-conversations),
   [discuss.huggingface.co](https://discuss.huggingface.co/)
2. **DEV `#showdev`** — full article body (linking out violates their terms), `canonical_url` home, 4 tags max, AI-assistance disclosure per their CoC
3. **Fosstodon** (needs an invite; registrations closed) — as a person, never a bare link, ≤3 hashtags. Their ad rule bans "repetitive self-promotion **for profit**"; Otto is free and AGPL, so a real post with context sits inside every clause. Fallbacks: hachyderm.io, floss.social.
4. **Bluesky** — compounding, not a launch channel. Getting added to dev starter packs is the highest-leverage action. No link suppression, unlike X.
5. **Reddit, tiered** — one sub at a time, days apart, never near-identical text, and read [channels.md](channels.md) for the verbatim rule of each:
   - **r/selfhosted is gated until ~2026-10-05.** Rule 6, verbatim: projects "younger than 3 months (measured by **first public presence**)" may only be posted in the New Project Megathread. Otto's first public presence is 2026-07-05. Until then: **megathread only.** Rule 2 also requires the app be "production ready and have docs."
   - Then r/LocalLLaMA → r/ClaudeCode (flair required: `Showcase` or `Resource`) → r/coolgithubprojects, r/mcp → r/opensource (sanctioned "Promotional" flair).
   - **r/programming is not a flat no** — the rule is narrower than assumed. Verbatim: "Technical writeups on what makes a project technically challenging, interesting, or educational are allowed and encouraged, but just a link to a github page or a list of features is not." That is a Phase 4 essay target, not a Phase 3 project post.
   - **r/webdev is Showoff Saturday only**, and its rules name the 9:1 ratio explicitly.
6. **Discord** — join five, lurk a week, read `#rules`, post in at most two. Order: OpenCode → **Zoo Code** → LM Studio → Ollama → Aider. **Latent Space last**, once there's a result worth showing; a bad drop there poisons the newsletter and podcast tier.

**The Zoo Code opening:** Roo Code archived 2026-05-15 with 24,362 stars. The community fork
[Zoo Code](https://www.zoocode.dev/) has 1,367 stars and a "help us keep this alive" posture. That
audience is displaced, actively looking, philosophically aligned, and nobody is courting them.

### Phase 4 — The citable artifact (the highest-leverage idea in this plan)

**The Aider lesson.** Aider's own launch thread scored 432 points once. Its _leaderboard_ generated
front-page HN threads for years — "Claude 3 beats GPT-4 on Aider's code editing benchmark" (202 pts)
charted **two weeks before the tool itself did**, and every subsequent frontier model release became a
free Aider mention. Epoch AI, llm-stats and Steel.dev all independently republish it. The 2026
equivalent: OpenCode's single biggest thread of the year was _"Claude Code sends 33k tokens before
reading the prompt; OpenCode sends 7k"_ — **705 points for a measurement, not a launch.**

A project with no audience cannot buy attention. It can build something other people are obliged to
cite.

**Otto is uniquely positioned to build the one benchmark nobody else can.** Every competitor measures
_models_. Otto runs six providers through one harness, which means it can measure **harnesses** —
same task, same repo, same success criteria, across Claude Code, Codex, Copilot, OpenCode, Pi, and a
local Qwen on LM Studio, reporting tokens, cost, wall-clock, and task success. Nobody else has that
instrumentation, and the observed-subagent + usage-ledger work already in the tree is most of the
measurement plumbing.

Requirements for it to actually get cited: published methodology, reproducible harness in the repo,
raw results as data (JSON/CSV), a permanent URL, honest reporting when Otto's own numbers are
unflattering, and a re-run on every notable model or provider release. **If it is perceived as
marketing, it is worthless**; its entire value is that a third party can point at it in an argument.

Sequenced here — after the pipeline, before the big swing — because it takes real engineering and
because the Show HN is far stronger with it in hand.

### Phase 5 — The writing engine (the compounding one)

The Cline lesson: **the argument is the marketing, and the product is the proof.** One substantial
essay every 2–3 weeks on the independence thesis, published on otto-code.me, cross-posted to DEV with
canonical, submitted to Changelog News, occasionally to Lobsters (technical deep-dives only).

The essay that must be written **before** it is needed: _"What happens when your provider changes the
rules."_ OpenCode gained ~18,000 stars in two weeks when Anthropic blocked it. The next such incident
will happen; the piece should already exist. Full calendar in [content.md](content.md).

### Phase 6 — The big swing (once, and retryable)

**Show HN**, spent on a real milestone — v1.0, or the moment provider parity is complete across all
providers. Not a version bump; HN's Show HN rules exclude "new features and upgrades." Otto qualifies
cleanly: installable, runnable, no signup, non-trivial, authored by the poster.

Immediately downstream and gated on it: three YouTube pitches (IndyDevDan, Matt Williams of Ollama,
GosuCoder), a [changelog.com/request](https://changelog.com/request) episode request, and a
[syntax.fm/potluck](https://syntax.fm/potluck) question. Hacker Newsletter and Fireship cannot be
pitched at all — they are won by ranking on HN, which is why HN is the upstream lever for the whole
cascade.

Rules for the day, non-negotiable: maker comment in the first five minutes; answer every substantive
comment for the first hour, **personally, never AI-written or AI-polished**; never solicit votes
anywhere; never delete and repost (it forfeits the [second-chance pool](https://news.ycombinator.com/pool)).

**dang's own stated advice for what works here** — worth following literally: _"your best bet is to do
a detailed technical writeup of what you've achieved and how. The more detail, the better. HN readers
love to look under the hood."_ The Phase 4 benchmark is exactly that shape.

**Budget for a retry — it is legitimate and it works.** Void's author posted the same project twice
five days apart: 13 points, then **347 points**. Same project, same author, near-identical title, 26×
difference. Timing and framing dominate merit on `/newest`. And eight months later a _third party_
resubmitted Void to 948 points — so a resubmission by someone else is both allowed and often stronger.
The rule that matters is "don't delete and repost," not "never post twice."

---

## 7. Measurement — four numbers, no telemetry

Otto collects nothing from users and that does not change. Everything below is first-party or public
API.

| Signal                               | Source                                                        | Gotcha                                                                     |
| ------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Unique repo views + top referrer** | GitHub `/repos/{o}/{r}/traffic/views` + `/popular/referrers`  | **14-day retention.** Requires push access. Snapshot daily or lose it.     |
| **New stars per day**                | `/stargazers` with `Accept: application/vnd.github.star+json` | Cleanest awareness proxy for an OSS project                                |
| **Release asset downloads per day**  | `releases[].assets[].download_count`, daily delta             | Cumulative only; excludes source tarballs and `git clone`                  |
| **Clicks per channel**               | Own `/go` redirector logs                                     | The only real attribution — GitHub's referrer API gives hostnames, no UTMs |

Supporting: Cloudflare Web Analytics or GoatCounter (cookieless) on otto-code.me, npm stats for
`@otto-code/cli` (CI-inflated, trend only), Discord `approximate_member_count`, Docker Hub pulls.

Referrer reality in 2026: browsers default to `strict-origin-when-cross-origin`, so expect
`https://news.ycombinator.com/` but not the thread path. Origin-level attribution is enough.

**Explicitly not tracked:** anything about a user, anything in the app, anything in the daemon.

---

## 8. Risks

| Risk                                                                                                            | Severity     | Mitigation                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Silent shadowban** — posts invisible to everyone, no notification, weeks of posting into a void               | **High**     | Automated logged-out fetch of every submission 15 min after send ([runbook.md](runbook.md) §4). Cheap, legitimate, and the highest-value telemetry in the system.                                                                                                                                                                          |
| **Domain ban on HN or a large subreddit** — invisible; every future submission of otto-code.me dies silently    | **Critical** | One account, never a second. Manual submission only. Give:take ratio enforced in code. Never solicit votes. **Recoverable: email `hn@ycombinator.com`** — dang lifts domain bans routinely, and over-submission alone has caused accidental bans (tylervigen.com was banned purely for being posted too often). The danger is not knowing. |
| **AI-written text detected** — the fastest credibility burn available in 2026, and doubly ironic for an AI tool | **High**     | Drafts are inputs, never outputs. HN and Lobsters replies are 100% human. Disclose AI assistance where required (DEV).                                                                                                                                                                                                                     |
| **Paseo relationship mishandled** — reads as a value-extracting fork                                            | **High**     | Lead with the fork, always, unprompted. Credit upstream in every long-form piece. Never a comparison that disparages.                                                                                                                                                                                                                      |
| **Anthropic ToS wording sloppy** — a well-informed audience that watched OpenCode get blocked will check        | Medium       | Approved phrasing in [runbook.md](runbook.md), used verbatim.                                                                                                                                                                                                                                                                              |
| **Solo-maintainer attrition** — the Aider/Void failure mode; directories drop inactive projects                 | Medium       | Cadence caps keep outreach cheap. Shipping _is_ the channel; protect build time over post volume.                                                                                                                                                                                                                                          |
| **Positioning overtaken again** — the category moved twice in five months                                       | Medium       | Quarterly positioning review against the competitor set; the dossier tracks it.                                                                                                                                                                                                                                                            |
| **One shot per community** — most channels cannot be retried                                                    | Medium       | The Phase 0 gate exists entirely for this.                                                                                                                                                                                                                                                                                                 |

---

## 9. Non-goals

Stated so they don't get relitigated:

- **No vote solicitation, ever, anywhere.** Banned by HN, Reddit, and Product Hunt; detection is good and consequences are permanent.
- **No second account, no alt, no "project account" posting alongside the maker account.** Single strongest astroturf signal on every platform.
- **No automated replies, likes, follows, or votes.** Prohibited by Bluesky, X, Reddit, Discord.
- **No Discord listening in servers we don't own** — ToS-prohibited in substance; automated user accounts are a ban-on-detection offense.
- **No paid placement, sponsored reviews, or press-release lanes.** Nothing is being sold; buying attention would undercut the entire positioning.
- **No Product Hunt launch.** Wrong audience (founders and marketers, not people who will run a daemon), ~144 average upvotes in H1 2026, a permanent public number attached to Otto, and ban clauses that trigger on things solo makers do innocently.
- **No Hashnode, no Medium.** Hashnode paywalled its API in May 2026 and DEV does everything it does for free; Medium closed Boost nominations 2026-05-31 and de-distributes self-promotional writing.
- **No F-Droid** until GMS/Firebase are stripped from the Android build — their inclusion policy forbids those outright.
- **No X spend** beyond, at most, Premium — post reads cost $0.005 and posts containing a URL cost $0.20 each.
- **No growth-hacking, no engagement-bait, no "we're live on Product Hunt" DMs.**

---

## 10. Open decisions

1. **When is the Show HN?** Recommend gating it on provider parity being complete across all providers — the wedge from §2b — rather than a version number. Needs a call.
2. **Fosstodon or self-host?** Fosstodon registrations are closed (invite-only) and it is the highest rules-risk surface on the list. A single-user Mastodon instance sidesteps instance rules entirely but starts with zero graph. Recommend: try for the invite, fall back to hachyderm.io.
3. **X Premium?** The one paid item with a documented mechanical effect — March 2026 killed link reach for non-Premium accounts. Recommend deferring until there's a clip worth boosting.
4. **Does the pipeline run inside Otto** (scheduled agent + personality, dogfooding, cheapest build) **or as a standalone GitHub Action** (survives the daemon being off, but scheduled workflows in public repos auto-disable after 60 days of repo inactivity)? Recommend Otto-hosted with an Action as a dead-man's switch. See [pipeline.md](pipeline.md) §6.
5. **Do we court the Zoo Code / Roo Code diaspora explicitly**, or just show up where they already are? Recommend the latter — an explicit "refugees welcome" post reads as opportunistic.

---

## Provenance

Landscape research conducted 2026-07-19. **Every Reddit rule in [channels.md](channels.md) is
secondhand** — Reddit blocks automated reading at the crawler level, and third-party rule aggregators
in this space are low-quality SEO content. Phase 0.9 exists to fix that by hand. Everything marked
verified in the dossier was fetched from a primary source on that date; re-verify anything older than
90 days before acting on it.
