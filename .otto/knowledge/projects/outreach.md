---
id: "outreach"
kind: "project"
title: "Outreach"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "charter"
created_at: "2026-08-08T06:17:57.812Z"
updated_at: "2026-08-08T06:19:49.627Z"
---

# Outreach

<!-- compiled_truth -->

# Outreach: getting Otto known

**Status:** charter, approved to plan · **Opened:** 2026-07-19 · **Owner:** Draekz (maker voice)

Otto is free, open source (AGPL-3.0), self-hosted, sells nothing, and collects nothing. The entire
goal of this project is **awareness**: that a developer who would love Otto can find out it exists.
No funnel, no conversion target, no revenue. The only success metric that matters is _people who
would want this, know about this_.

This charter is the strategy. The operational detail lives in four sibling files:

| File                       | What's in it                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| [channels.md](channels.md) | The channel dossier - every target, its verified rules, gates, cadence caps, and confidence level |
| [pipeline.md](pipeline.md) | The AI automation architecture - what the machine does, what it must never do, and why            |
| [content.md](content.md)   | Message house, asset library, editorial calendar, the per-channel copy shapes                     |
| [runbook.md](runbook.md)   | Per-send checklist, guardrails, shadowban checks, incident response                               |

---

## 1. The three decisions that shape everything

Settled 2026-07-19 before planning began.

**Voice: the maker, first person, under Draekz.** Not a project account. Every channel that matters
for this category - Hacker News, r/LocalLLaMA, r/selfhosted, Lobsters, Fosstodon - rewards a person
and punishes a brand. HN's own guideline is explicit that "HN is a community-users should have an
identity that others can relate to." A branded account posting product copy reads as astroturf in
exactly the rooms we need. The fork-of-Paseo relationship also only reads as honest when a human
says it.

**Automation: draft queue, human send.** The AI does discovery, research, drafting, asset
generation, scheduling, compliance-checking and measurement - everything except pressing send and
except live conversation. This is not a compromise imposed by caution; §4 shows it is the only
architecture that survives 2026 platform enforcement, and the parts it forbids are precisely the
parts that determine whether a post succeeds.

**Timing: gated launch.** Nothing ships outward until Phase 0 exits. Outreach that lands on a thin
page converts once and never again, and most of these channels are one-shot - you do not get to
re-post to r/selfhosted in three months because the demo video wasn't ready the first time.

---

## 2. What the research changed

Three findings from the 2026-07-19 landscape sweep overturned the obvious plan. They are the reason
this charter is not "post it on Reddit and Hacker News."

### 2a. The mobile pitch is no longer a differentiator

- **2026-02-24**: Anthropic shipped [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control):
  continue a local session from phone or browser via claude.ai. First-party, free, zero setup.
- **2026-04**: Cline shipped mobile ("how to vibe code from your phone") and, in March, Kanban, a
  CLI-agnostic multi-agent orchestrator.

"Drive your local agents from your phone" was Otto's headline. As of five months ago it is table
stakes, offered first-party by the largest vendor in the category. **Leading with mobile in July 2026
invites the reply "Claude already does this."** Positioning must move (§3).

### 2b. Provider parity is the actual wedge, and nobody else claims it

The fork's founding mission - frontier-harness tooling for every provider, cloud and local alike - is
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
  product as proof - not from launches. That strategy costs writing, not money, which is exactly what
  a solo maker has.
- **OpenCode** went 0 → 187K stars with **no launch campaign at all** (debuted to ~30 people at a
  Toronto meetup). Its inflection was Anthropic blocking it on 2026-01-09 - ~18,000 stars in two
  weeks - because it was the neutral option when a vendor tightened the screws. Founder Jay V:
  _"OpenCode is not an AI product. It's a product designed to use AI… we're not betting on any single
  model or provider winning."_ That is Otto's thesis nearly verbatim.
- **Aider** (47.5K stars, last push 2026-05-22) and **Void** (28.9K, 2026-06-02) both stalled. Both
  will be dropped from directories: awesome-selfhosted removes projects inactive 6–12 months,
  daily.dev drops sources inactive 3+ months. **Directory listings are only durable if commits are.
  Visible shipping is itself a distribution channel.**

### 2d. The cold-start reality: verified 2026-07-19, and it governs everything

| Fact                              | Value                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `Draek2077/otto-code` made public | **2026-07-05 - 14 days ago**                                                        |
| Stars / forks / watchers          | **1 / 1 / 0**                                                                       |
| First public release              | **v0.3.2, 2026-07-05**                                                              |
| Releases since                    | ~20, current v0.6.3 (2026-07-18) - shipping hard                                    |
| GitHub-detected license           | was **`NOASSERTION`** - fixed 2026-07-19 (Phase 0.11); GitHub re-scans on next push |

Otto the product is mature. **Otto the public repository is two weeks old with one star**, and a
large share of the channels in this plan gate on repository age, release age, or star count. This is
not a footnote - it re-orders the entire plan:

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
distribution surface** - OpenCode had SST/Dax's following, Cline had the VS Code Marketplace, Aider
had a leaderboard the entire industry had to cite. **No clean solo-maker-from-zero case study exists.**
Expectations calibrated on 187K-star outcomes are miscalibrated.

That is precisely why §6 Phase 4 exists: the one lever available to a project with no audience is to
**build an artifact other people need to cite.**

**Conclusion: the plan is a permanence strategy, plus one citable artifact, with one big swing held
in reserve** - not a launch.

---

## 3. Positioning

### The one-line claim

> **Otto gives a local model the same harness a frontier vendor gives its own.**
> Open source, self-hosted, any provider, on your machine.

### Message house

| Pillar                     | Claim                                                                                                         | Proof we can show                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Parity** _(lead)_        | Browser-verified preview, observed subagents, MCP, compaction, artifacts - for LM Studio, not just for Claude | The side-by-side clip; `docs/preview.md`; the openai-compat native tool loop                 |
| **Neutrality**             | Six built-in providers plus any OpenAI-compatible endpoint. Switch when the landscape shifts.                 | Provider list; the ACP catalog; one workspace running two providers in split panes           |
| **Sovereignty**            | Your machine, your keys, your code. No telemetry, no account, no cloud dependency, no inference markup.       | AGPL repo; daemon architecture; `SECURITY.md`; the fact that there is nothing to sign up for |
| **A named cast**           | Personalities and teams - agents with roles, colors, voices, spawnable by other agents                        | The personalities demo scenario                                                              |
| **Everywhere** _(support)_ | Desktop, phone, web, CLI, remote daemon                                                                       | Mobile screenshots - **demoted from headline to supporting detail** per §2a                  |

### Things we must say precisely

- **"Otto is a fork of [Paseo](https://github.com/getpaseo/paseo)."** Say it first, every time,
  unprompted. Paseo is at 10,864 stars and actively maintained; its community overlaps ours
  completely. Led with, the fork relationship is a credibility asset and a courtesy. Discovered
  later, it is a scandal. The site already does this well ("proudly forked from Paseo") - the same
  discipline applies to every post, DM, and pitch.
- **How Otto talks to Claude.** Otto drives the user's own official Claude Code CLI / Agent SDK with
  their own credentials. It does **not** reuse or spoof OAuth tokens. Anthropic clarified in
  February 2026 that using Claude Free/Pro/Max OAuth tokens in third-party products is not
  permitted, and enforced it. This is a well-informed audience that will check, and getting the
  wording sloppy invites a hostile thread from people who watched OpenCode get blocked. See
  [runbook.md](runbook.md) for the approved phrasing.
- **What Otto does not have.** macOS builds are unsigned (Gatekeeper friction on first launch, no
  auto-update), no iOS build, Play is internal-track only. State it up front in every post.
  Volunteering the gap defuses it; being caught omitting it costs the thread.

### Anti-positioning: what we never say

Not "the best." Not "Cursor killer." Not a feature-list dump. Never a comparison that disparages
Paseo, Cline, OpenCode, or Zed - we are asking to stand in their communities. Never "vibe coding" as
our own descriptor: Lobsters built a `vibecoding` tag specifically so members can _filter it out_,
and the phrase reads as marketing to the exact senior audience we want. Use it only to describe the
category when someone else raised it.

---

## 4. The automation boundary: and why "fully automated" is the wrong target

The ask was a strategy "fully automated by AI." Here is the honest engineering answer: **roughly 80%
of the work automates cleanly and legally, and the remaining 20% is both prohibited and
outcome-determining.** A system that automates the last 20% does not perform 20% better - it gets the
domain banned.

### Hard prohibitions, verbatim

| Source                                                                                                                                  | Rule                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [HN guidelines](https://news.ycombinator.com/newsguidelines.html)                                                                       | **"Don't post generated text or AI-edited text. HN is for conversation between humans."** - note **AI-_edited_**: running your own draft through a model for polish is inside the prohibition |
| [Reddit](https://support.reddithelp.com/hc/en-us/articles/41180423371156-Manipulated-Content-and-Misleading-Behavior) (upd. 2026-05-19) | AI content allowed **only if disclosed**: prohibits content "that presents itself as human-generated"; "be transparent and include a tag"                                                     |
| [Reddit spam policy](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam) (upd. 2026-05-19)                              | Never allowed: "Using tools (e.g., bots, generative AI tools) that may break Reddit or facilitate the proliferation of spam"                                                                  |
| [HN guidelines](https://news.ycombinator.com/newsguidelines.html)                                                                       | "Please don't use HN primarily for promotion… the primary use of the site should be for curiosity."                                                                                           |
| [Bluesky dev guidelines](https://docs.bsky.app/docs/support/developer-guidelines)                                                       | Prohibited: "Generating automated or bulk interactions, including any that would cause a notification to a user"                                                                              |
| [X developer guidelines](https://docs.x.com/developer-guidelines)                                                                       | Automated replies only where "the user engaged first," max one reply per interaction                                                                                                          |
| [Fosstodon rules](https://fosstodon.org/api/v1/instance)                                                                                | "DO NOT use automated tools to post without also monitoring and/or interacting from your account."                                                                                            |
| [sindresorhus/awesome](https://github.com/sindresorhus/awesome)                                                                         | "Fully AI-generated pull requests are not accepted."                                                                                                                                          |
| [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)                                                              | "resource recommendations must be created by human beings" - and PRs instead of the issue form risk repo restriction                                                                          |
| [daily.dev](https://docs.daily.dev)                                                                                                     | Rejects "AI-generated content… or content with characteristics typical of AI-generated material"                                                                                              |
| [Dev.to CoC](https://dev.to/code-of-conduct)                                                                                            | Requires **disclosing AI assistance** used to create content                                                                                                                                  |
| [Product Hunt](https://help.producthunt.com/en/articles/3615694-community-guidelines)                                                   | "using bots… any other form of artificially increasing activity" → permanent removal                                                                                                          |

Also structural: **Hacker News, Lobsters, and Product Hunt launches have no write API at all.** There
is nothing to automate even if it were permitted.

### Enforcement is velocity-shaped, not intent-shaped

Reddit's [March 2026 human-verification rollout](https://techcrunch.com/2026/03/25/reddit-bots-new-human-verification-requirements/)
fires on account signals explicitly including **"how quickly the account is attempting to write or
post content."** A queue where a human approves twenty items and fires them in ten minutes is _more_
dangerous than no automation - the human click is invisible to the classifier; the timing
distribution is not. Reddit also now offers an `[App]` label for registered automated accounts;
unlabeled automation is the thing being hunted.

The fatal signature across every platform is the same, and it is not "used AI":

1. One domain, many accounts _(strongest astroturf signal on both HN and Reddit)_
2. Reply velocity that is machine-shaped
3. Topical monomania - an account whose whole history is one project
4. Templated phrasing that moderators pattern-match across a sub
5. Answering questions with your product daily instead of weekly

### The resulting split

| The machine owns (fully automated)                                                      | The human owns (never automated)                                |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Watching HN/GitHub/RSS/Bluesky for relevant threads                                     | Pressing send, anywhere                                         |
| Maintaining the channel dossier and flagging stale rules                                | Every reply in a live thread (HN especially - never AI-written) |
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
recommended implementation is that **Otto runs its own outreach** - a "Herald" personality on a cron,
producing the review queue as an artifact. That is both the cheapest build and, itself, a story worth
telling. See [pipeline.md](pipeline.md) §6.

---

## 5. Separation: where this lives

Per the fork convention that the website is independent of the product, outreach is independent of
both.

- **Code:** `packages/outreach/` - a new workspace package. **Zero imports from `@otto-code/protocol`,
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

### Phase 0: Readiness gate ⛔ nothing goes outward until every box is checked

The landing surface is what every channel points at. Today the blog has zero posts, the demo pipeline's
output is not wired into the site, and the sponsor link points at upstream's author.

| #    | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Where                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 0.1  | **Reposition the landing page** per §3 - parity as the headline, mobile demoted to a supporting section                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `packages/website/src/routes/index.tsx`      |
| 0.2  | **The parity clip.** 40s, same task, Claude then local LM Studio, both browser-verifying. The single most important asset in this project.                                                                                                                                                                                                                                                                                                                                                                                                                 | `packages/app/demo/` → `site-demos` pipeline |
| 0.3  | **Wire demo assets into the site.** The pipeline produces manifests; the site consumes none of them and still uses hand-built mockups and static `phone-*.png`.                                                                                                                                                                                                                                                                                                                                                                                            | `packages/website` ← `public/demos/`         |
| 0.4  | **Three blog posts published** (see [content.md](content.md) §3 for the specific three). The blog system works; it has never been used.                                                                                                                                                                                                                                                                                                                                                                                                                    | `packages/website/posts/`                    |
| 0.5  | **`/press` page** - one-paragraph and one-line descriptions, logo pack, the parity clip, screenshots, honest limitations, contact. Every pitch in Phase 1 and 5 links here.                                                                                                                                                                                                                                                                                                                                                                                | `packages/website/src/routes/press.tsx`      |
| 0.6  | **`/go` redirector** - `otto-code.me/go?c=<channel>` → 302. GitHub's traffic API reports hostnames only, so this is the _only_ way to attribute a click to a channel without telemetry.                                                                                                                                                                                                                                                                                                                                                                    | `packages/website`                           |
| 0.7  | **Measurement baseline running** - daily snapshot of GitHub traffic/referrers/stars/download counts. GitHub keeps traffic for **14 days only**; unsnapshotted data is gone forever.                                                                                                                                                                                                                                                                                                                                                                        | `packages/outreach/`                         |
| 0.8  | ~~Fix the sponsor link~~ **Done 2026-07-19, and the original diagnosis was wrong.** The website is deliberate and correct: `/sponsor` and the landing page both state Otto takes no sponsorships and route support to Paseo, with the upstream author named in surrounding copy. Only the **app** was misleading - a bare "Sponsor" button sitting between Otto's own Star and Feedback buttons, silently opening upstream's page. Relabelled to **"Sponsor Paseo"** with a comment recording why.                                                         | `packages/app` (website needed no change)    |
| 0.9  | **Read every target subreddit's sidebar by hand and fill in [channels.md](channels.md).** Reddit blocks automated reading entirely; every Reddit rule in the dossier is currently secondhand. ~20 minutes.                                                                                                                                                                                                                                                                                                                                                 | `projects/outreach/channels.md`              |
| 0.10 | ~~Verify the 4-month rule~~ **Done 2026-07-19:** first release v0.3.2 on 2026-07-05 → awesome-selfhosted eligible **2026-11-05**. Calendar it.                                                                                                                                                                                                                                                                                                                                                                                                             | -                                            |
| 0.11 | ~~Fix license detection~~ **Done 2026-07-19.** The 10-line Paseo/Boudra preamble moved out of `LICENSE` into `NOTICE`, preserved verbatim and with a note explaining the relocation. `LICENSE` is now byte-identical to the canonical AGPL-3.0 text from gnu.org (verified, 34,502 chars), so `licensee`/SPDX tooling will detect it. Also corrected two stale facts in `NOTICE` (`otto-code.ai` → `otto-code.me`; bundle IDs are `me.ottocode*` mobile / `ai.ottocode.desktop`). **Worth a human sanity-check - it touches upstream's copyright notice.** | `LICENSE`, `NOTICE`                          |
| 0.12 | ~~Add license field~~ **Done 2026-07-19.** Root already had one. Added `"license": "AGPL-3.0-or-later"` to the **nine** packages missing it - the six published (`protocol`, `client`, `server`, `cli`, `highlight`, `relay`) plus `visualizer`, `app`, `website`. `expo-two-way-audio` stays MIT (upstream's own library).                                                                                                                                                                                                                                | 9 × `packages/*/package.json`                |

**Exit criteria:** a stranger landing on otto-code.me from a cold link sees, within ten seconds, what
Otto is, watches it work, and can download it - and the dossier has no unverified rule for any Phase
1 or 3 channel.

### Phase 1: Permanent surfaces (formal routes, zero etiquette risk)

Every item here is an official submission channel where self-submission is explicitly invited. No
community judgment, no ban risk, no timing games. **This is the highest value-per-risk work in the
project and it is mostly unclaimed.**

**Available now:**

| Priority | Target                                                                                                           | Why / criteria                                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**    | [jamesmurdza/awesome-ai-devtools](https://github.com/jamesmurdza/awesome-ai-devtools) PR                         | 3,892★, active. **No star, age, or license gate.** Has `AI-Native IDEs`, `Terminal Agents`, `Desktop & Mobile Applications`, `Multi-Agent Orchestration` - Otto fits several. Best value-per-effort available today. |
| **2**    | [selfh.st](https://selfh.st) - submission form at the bottom of each weekly issue                                | Self-Host Weekly is publishing (latest 2026-07-17). Human curator, exactly Otto's audience, free. ~20 min.                                                                                                           |
| **3**    | [changelog.com/news/submit](https://changelog.com/news/submit)                                                   | Verbatim: "submitting your own work" is encouraged. Zero risk. Also the on-ramp to a Changelog episode.                                                                                                              |
| **4**    | `hello@console.dev`                                                                                              | Their [selection criteria](https://console.dev/selection-criteria) read like Otto's spec sheet; the betas section takes pre-1.0. No sponsored reviews - winning it means something.                                  |
| **5**    | [Anthropic project form](https://form.typeform.com/to/VIUAjxNi)                                                  | Official "share projects for potential feature on Claude's social channels." Pure upside.                                                                                                                            |
| **6**    | [bradAGI/awesome-cli-coding-agents](https://github.com/bradAGI/awesome-cli-coding-agents)                        | 833★, the most on-topic list that exists. `packages/cli` satisfies its CLI requirement. 10-minute PR.                                                                                                                |
| **7**    | [rafska/awesome-local-llm](https://github.com/rafska/awesome-local-llm)                                          | 2,409★. Zero quality bar. The LM Studio/Ollama angle is the hook.                                                                                                                                                    |
| **8**    | **Create the AlternativeTo account** (submit ≥1 week later)                                                      | 1-week account age gate. The prize isn't Otto's page - it's appearing as an alternative on the Cursor / Claude Code / Zed pages.                                                                                     |
| 9        | `submissions@tldr.tech` (TLDR AI, TLDR Web Dev)                                                                  | 7.2M developers, free                                                                                                                                                                                                |
| 10       | [LibHunt](https://www.libhunt.com/repo/submit) · [SaaSHub](https://www.saashub.com/services/submit)              | 60-second submissions. SaaSHub: **list competitors or the submission goes to the back of the queue.** LibHunt auto-ingests any HN/Reddit/DEV mention afterwards.                                                     |
| 11       | [Dev Hunt](https://devhunt.org) · [Peerlist Launchpad](https://peerlist.io/launchpad)                            | Weekly cycles, dev-only audiences, free, low competition. Peerlist ranks on link clicks, which favors things people actually try.                                                                                    |
| 12       | [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) - **web issue form only, never a PR** | 50,417★. A PR "risks being restricted from interacting with this repository." Currently pausing recommendations - check first. Their own CONTRIBUTING warns that get-on-the-list-as-strategy usually fails.          |

**Gated - set tripwires, do not attempt early:**

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

**Deliberately skipped, with reasons:** `sindresorhus/awesome` (lists other _lists_, not projects - there is
no path to add Otto); `Shubhamsaboo/awesome-llm-apps` (hand-built in-repo apps, not a directory);
`punkpeye/awesome-mcp-servers` (2,919 contributors, ~2,844 open issues - and only Otto's MCP server
would qualify, not Otto); `modelcontextprotocol/servers` (closed to listings); `RunaCapital/awesome-oss-alternatives`
(requires being a for-profit company); `sourcegraph/awesome-code-ai` (archived); There's An AI For That
and Futurepedia (no free path - $49–$347, prompt-tourist audience).

### Phase 1b: Packaging is a discovery channel

Overlooked in the original framing and worth as much as any post: package managers and homelab app
stores are **browsable, indexed, permanently-listed surfaces with their own built-in traffic**. Every
one of these also lowers install friction, which is what actually converts a reader into a user.

| Target                                                                                            | Effort  | Notes                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Big Bear CasaOS](https://github.com/bigbeartechworld/big-bear-casaos)**                        | 0.5–1h  | **Best ROI here.** Forum post, not a PR - the maintainer packages it, and it ships alongside CasaOS/ZimaOS app stores.                                                                                                                                                                                                                                                                      |
| **[Flathub](https://docs.flathub.org/docs/for-app-authors/submission)**                           | 8–16h   | Highest-value desktop channel; default backend for GNOME Software and KDE Discover. Target the `new-pr` branch. **App ID must be `me.otto_code.Otto`** - dashes become underscores. No network during build → `flatpak-node-generator`. PR template requires a video and an authorship attestation. Disable electron-updater in this build.                                                 |
| **[Obtainium](https://github.com/ImranR98/apps.obtainium.imranr.dev)**                            | 1h      | **The real Android path.** Self-submitted PR, no licensing/AI/tracker gate. Needs APKs (not AAB) on GitHub Releases with stable arch-tagged names and a never-rotated signing key.                                                                                                                                                                                                          |
| **[winget](https://learn.microsoft.com/en-us/windows/package-manager/package/repository)**        | 3–5h    | The NSIS `.exe` qualifies. Automate afterwards with [winget-releaser](https://github.com/vedantmgoyal9/winget-releaser).                                                                                                                                                                                                                                                                    |
| **AUR**                                                                                           | 2–3h    | No notability gate; Google-indexed. Source the versioned `.tar.gz`/rpm - **not** the deliberately version-less AppImage.                                                                                                                                                                                                                                                                    |
| **[Unraid Community Apps](https://forums.unraid.net/topic/87144-ca-application-policies-notes/)** | 2–4h    | Strongest browse habit of any homelab store. Requires a permanent support thread and 2FA on the GitHub org.                                                                                                                                                                                                                                                                                 |
| **[Umbrel](https://github.com/getumbrel/umbrel-apps)**                                            | 4–8h    | amd64+arm64 already shipped. Forbids mounting the host Docker socket - see the caveat below.                                                                                                                                                                                                                                                                                                |
| **Snap** (classic confinement)                                                                    | 4–6h    | Classic confinement is explicitly allowed for IDEs. **Frame the store-request as "IDE," not "needs host access."** Publisher vetting at 1★ is a real gate - do after Flathub.                                                                                                                                                                                                               |
| Portainer templates (`v3` branch), Scoop Extras, nixpkgs, Chocolatey, Docker Hub DSOS             | 1–6h ea | Low individual value, cheap, fire-and-forget. DSOS qualifies Otto explicitly: "in active development with no pathway to commercialization."                                                                                                                                                                                                                                                 |
| **Skip: F-Droid and IzzyOnDroid**                                                                 | -       | F-Droid forbids GMS/Firebase (`expo-notifications`) and OTA executable delivery (`expo-updates`), has no committed `android/`, and would apply the _Non-Free Network Services_ anti-feature. IzzyOnDroid is "strongly opposed to apps which are fully or in part created by generative AI tools" and separately rejects apps for accessing big AI platforms. 40–80h for a likely rejection. |

**Positioning caveat for the homelab stores:** Otto's pitch is "your code stays on your machine," which
degrades badly inside a sandbox that only sees its own volume. Decide the story before submitting, and
make sure provider credential setup works from the web UI without SSHing into a container.

### Phase 2: Build the pipeline

Full architecture in [pipeline.md](pipeline.md). Sequenced after Phase 1 because Phase 1 needs no
tooling and shouldn't wait for it.

### Phase 3: Community presence (earn standing before spending it)

Ordered by permanence and inverse risk. **Forums before Discord** - a forum post is SEO-indexed and
permanent; a Discord message scrolls away in four minutes.

1. **Forums**: [community.openai.com](https://community.openai.com/) Codex category,
   [GitHub Copilot Conversations](https://github.com/orgs/community/discussions/categories/copilot-conversations),
   [discuss.huggingface.co](https://discuss.huggingface.co/)
2. **DEV `#showdev`**: full article body (linking out violates their terms), `canonical_url` home, 4 tags max, AI-assistance disclosure per their CoC
3. **Fosstodon** (needs an invite; registrations closed) - as a person, never a bare link, ≤3 hashtags. Their ad rule bans "repetitive self-promotion **for profit**"; Otto is free and AGPL, so a real post with context sits inside every clause. Fallbacks: hachyderm.io, floss.social.
4. **Bluesky**: compounding, not a launch channel. Getting added to dev starter packs is the highest-leverage action. No link suppression, unlike X.
5. **Reddit, tiered**: one sub at a time, days apart, never near-identical text, and read [channels.md](channels.md) for the verbatim rule of each:
   - **r/selfhosted is gated until ~2026-10-05.** Rule 6, verbatim: projects "younger than 3 months (measured by **first public presence**)" may only be posted in the New Project Megathread. Otto's first public presence is 2026-07-05. Until then: **megathread only.** Rule 2 also requires the app be "production ready and have docs."
   - Then r/LocalLLaMA → r/ClaudeCode (flair required: `Showcase` or `Resource`) → r/coolgithubprojects, r/mcp → r/opensource (sanctioned "Promotional" flair).
   - **r/programming is not a flat no**: the rule is narrower than assumed. Verbatim: "Technical writeups on what makes a project technically challenging, interesting, or educational are allowed and encouraged, but just a link to a github page or a list of features is not." That is a Phase 4 essay target, not a Phase 3 project post.
   - **r/webdev is Showoff Saturday only**, and its rules name the 9:1 ratio explicitly.
6. **Discord**: join five, lurk a week, read `#rules`, post in at most two. Order: OpenCode → **Zoo Code** → LM Studio → Ollama → Aider. **Latent Space last**, once there's a result worth showing; a bad drop there poisons the newsletter and podcast tier.

**The Zoo Code opening:** Roo Code archived 2026-05-15 with 24,362 stars. The community fork
[Zoo Code](https://www.zoocode.dev/) has 1,367 stars and a "help us keep this alive" posture. That
audience is displaced, actively looking, philosophically aligned, and nobody is courting them.

### Phase 4: The citable artifact (the highest-leverage idea in this plan)

**The Aider lesson.** Aider's own launch thread scored 432 points once. Its _leaderboard_ generated
front-page HN threads for years - "Claude 3 beats GPT-4 on Aider's code editing benchmark" (202 pts)
charted **two weeks before the tool itself did**, and every subsequent frontier model release became a
free Aider mention. Epoch AI, llm-stats and Steel.dev all independently republish it. The 2026
equivalent: OpenCode's single biggest thread of the year was _"Claude Code sends 33k tokens before
reading the prompt; OpenCode sends 7k"_ - **705 points for a measurement, not a launch.**

A project with no audience cannot buy attention. It can build something other people are obliged to
cite.

**Otto is uniquely positioned to build the one benchmark nobody else can.** Every competitor measures
_models_. Otto runs six providers through one harness, which means it can measure **harnesses** -
same task, same repo, same success criteria, across Claude Code, Codex, Copilot, OpenCode, Pi, and a
local Qwen on LM Studio, reporting tokens, cost, wall-clock, and task success. Nobody else has that
instrumentation, and the observed-subagent + usage-ledger work already in the tree is most of the
measurement plumbing.

Requirements for it to actually get cited: published methodology, reproducible harness in the repo,
raw results as data (JSON/CSV), a permanent URL, honest reporting when Otto's own numbers are
unflattering, and a re-run on every notable model or provider release. **If it is perceived as
marketing, it is worthless**; its entire value is that a third party can point at it in an argument.

Sequenced here - after the pipeline, before the big swing - because it takes real engineering and
because the Show HN is far stronger with it in hand.

### Phase 5: The writing engine (the compounding one)

The Cline lesson: **the argument is the marketing, and the product is the proof.** One substantial
essay every 2–3 weeks on the independence thesis, published on otto-code.me, cross-posted to DEV with
canonical, submitted to Changelog News, occasionally to Lobsters (technical deep-dives only).

The essay that must be written **before** it is needed: _"What happens when your provider changes the
rules."_ OpenCode gained ~18,000 stars in two weeks when Anthropic blocked it. The next such incident
will happen; the piece should already exist. Full calendar in [content.md](content.md).

### Phase 6: The big swing (once, and retryable)

**Show HN**, spent on a real milestone - v1.0, or the moment provider parity is complete across all
providers. Not a version bump; HN's Show HN rules exclude "new features and upgrades." Otto qualifies
cleanly: installable, runnable, no signup, non-trivial, authored by the poster.

Immediately downstream and gated on it: three YouTube pitches (IndyDevDan, Matt Williams of Ollama,
GosuCoder), a [changelog.com/request](https://changelog.com/request) episode request, and a
[syntax.fm/potluck](https://syntax.fm/potluck) question. Hacker Newsletter and Fireship cannot be
pitched at all - they are won by ranking on HN, which is why HN is the upstream lever for the whole
cascade.

Rules for the day, non-negotiable: maker comment in the first five minutes; answer every substantive
comment for the first hour, **personally, never AI-written or AI-polished**; never solicit votes
anywhere; never delete and repost (it forfeits the [second-chance pool](https://news.ycombinator.com/pool)).

**dang's own stated advice for what works here** - worth following literally: _"your best bet is to do
a detailed technical writeup of what you've achieved and how. The more detail, the better. HN readers
love to look under the hood."_ The Phase 4 benchmark is exactly that shape.

**Budget for a retry - it is legitimate and it works.** Void's author posted the same project twice
five days apart: 13 points, then **347 points**. Same project, same author, near-identical title, 26×
difference. Timing and framing dominate merit on `/newest`. And eight months later a _third party_
resubmitted Void to 948 points - so a resubmission by someone else is both allowed and often stronger.
The rule that matters is "don't delete and repost," not "never post twice."

---

## 7. Measurement: four numbers, no telemetry

Otto collects nothing from users and that does not change. Everything below is first-party or public
API.

| Signal                               | Source                                                        | Gotcha                                                                     |
| ------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Unique repo views + top referrer** | GitHub `/repos/{o}/{r}/traffic/views` + `/popular/referrers`  | **14-day retention.** Requires push access. Snapshot daily or lose it.     |
| **New stars per day**                | `/stargazers` with `Accept: application/vnd.github.star+json` | Cleanest awareness proxy for an OSS project                                |
| **Release asset downloads per day**  | `releases[].assets[].download_count`, daily delta             | Cumulative only; excludes source tarballs and `git clone`                  |
| **Clicks per channel**               | Own `/go` redirector logs                                     | The only real attribution - GitHub's referrer API gives hostnames, no UTMs |

Supporting: Cloudflare Web Analytics or GoatCounter (cookieless) on otto-code.me, npm stats for
`@otto-code/cli` (CI-inflated, trend only), Discord `approximate_member_count`, Docker Hub pulls.

Referrer reality in 2026: browsers default to `strict-origin-when-cross-origin`, so expect
`https://news.ycombinator.com/` but not the thread path. Origin-level attribution is enough.

**Explicitly not tracked:** anything about a user, anything in the app, anything in the daemon.

---

## 8. Risks

| Risk                                                                                                            | Severity     | Mitigation                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Silent shadowban** - posts invisible to everyone, no notification, weeks of posting into a void               | **High**     | Automated logged-out fetch of every submission 15 min after send ([runbook.md](runbook.md) §4). Cheap, legitimate, and the highest-value telemetry in the system.                                                                                                                                                                          |
| **Domain ban on HN or a large subreddit** - invisible; every future submission of otto-code.me dies silently    | **Critical** | One account, never a second. Manual submission only. Give:take ratio enforced in code. Never solicit votes. **Recoverable: email `hn@ycombinator.com`** - dang lifts domain bans routinely, and over-submission alone has caused accidental bans (tylervigen.com was banned purely for being posted too often). The danger is not knowing. |
| **AI-written text detected** - the fastest credibility burn available in 2026, and doubly ironic for an AI tool | **High**     | Drafts are inputs, never outputs. HN and Lobsters replies are 100% human. Disclose AI assistance where required (DEV).                                                                                                                                                                                                                     |
| **Paseo relationship mishandled** - reads as a value-extracting fork                                            | **High**     | Lead with the fork, always, unprompted. Credit upstream in every long-form piece. Never a comparison that disparages.                                                                                                                                                                                                                      |
| **Anthropic ToS wording sloppy** - a well-informed audience that watched OpenCode get blocked will check        | Medium       | Approved phrasing in [runbook.md](runbook.md), used verbatim.                                                                                                                                                                                                                                                                              |
| **Solo-maintainer attrition** - the Aider/Void failure mode; directories drop inactive projects                 | Medium       | Cadence caps keep outreach cheap. Shipping _is_ the channel; protect build time over post volume.                                                                                                                                                                                                                                          |
| **Positioning overtaken again** - the category moved twice in five months                                       | Medium       | Quarterly positioning review against the competitor set; the dossier tracks it.                                                                                                                                                                                                                                                            |
| **One shot per community** - most channels cannot be retried                                                    | Medium       | The Phase 0 gate exists entirely for this.                                                                                                                                                                                                                                                                                                 |

---

## 9. Non-goals

Stated so they don't get relitigated:

- **No vote solicitation, ever, anywhere.** Banned by HN, Reddit, and Product Hunt; detection is good and consequences are permanent.
- **No second account, no alt, no "project account" posting alongside the maker account.** Single strongest astroturf signal on every platform.
- **No automated replies, likes, follows, or votes.** Prohibited by Bluesky, X, Reddit, Discord.
- **No Discord listening in servers we don't own**: ToS-prohibited in substance; automated user accounts are a ban-on-detection offense.
- **No paid placement, sponsored reviews, or press-release lanes.** Nothing is being sold; buying attention would undercut the entire positioning.
- **No Product Hunt launch.** Wrong audience (founders and marketers, not people who will run a daemon), ~144 average upvotes in H1 2026, a permanent public number attached to Otto, and ban clauses that trigger on things solo makers do innocently.
- **No Hashnode, no Medium.** Hashnode paywalled its API in May 2026 and DEV does everything it does for free; Medium closed Boost nominations 2026-05-31 and de-distributes self-promotional writing.
- **No F-Droid** until GMS/Firebase are stripped from the Android build - their inclusion policy forbids those outright.
- **No X spend** beyond, at most, Premium - post reads cost $0.005 and posts containing a URL cost $0.20 each.
- **No growth-hacking, no engagement-bait, no "we're live on Product Hunt" DMs.**

---

## 10. Open decisions

1. **When is the Show HN?** Recommend gating it on provider parity being complete across all providers - the wedge from §2b - rather than a version number. Needs a call.
2. **Fosstodon or self-host?** Fosstodon registrations are closed (invite-only) and it is the highest rules-risk surface on the list. A single-user Mastodon instance sidesteps instance rules entirely but starts with zero graph. Recommend: try for the invite, fall back to hachyderm.io.
3. **X Premium?** The one paid item with a documented mechanical effect - March 2026 killed link reach for non-Premium accounts. Recommend deferring until there's a clip worth boosting.
4. **Does the pipeline run inside Otto** (scheduled agent + personality, dogfooding, cheapest build) **or as a standalone GitHub Action** (survives the daemon being off, but scheduled workflows in public repos auto-disable after 60 days of repo inactivity)? Recommend Otto-hosted with an Action as a dead-man's switch. See [pipeline.md](pipeline.md) §6.
5. **Do we court the Zoo Code / Roo Code diaspora explicitly**, or just show up where they already are? Recommend the latter - an explicit "refugees welcome" post reads as opportunistic.

---

## Provenance

Landscape research conducted 2026-07-19. **Every Reddit rule in [channels.md](channels.md) is
secondhand** - Reddit blocks automated reading at the crawler level, and third-party rule aggregators
in this space are low-quality SEO content. Phase 0.9 exists to fix that by hand. Everything marked
verified in the dossier was fetched from a primary source on that date; re-verify anything older than
90 days before acting on it.

---

## Companion document: channels.md

# Channel dossier

Every target, its **verbatim** rules, gates, and cadence cap. This file is the input the pipeline
reads before drafting anything (see [pipeline.md](pipeline.md) §3) - a channel with no verified rule
entry cannot be drafted for.

**Confidence legend:** ✅ fetched from the primary source · 🟡 secondary source, treat with suspicion ·
❓ unverified, **must be read by hand before use**

**Everything here was gathered 2026-07-19. Re-verify anything older than 90 days.** Platform rules in
this space changed four times in the first half of 2026 alone.

---

## 0. The eligibility calendar

Otto's public repo is 14 days old (2026-07-05), 1★. Many channels gate on age or popularity.

| Gate                                                        | Channel                            | Unblocks       |
| ----------------------------------------------------------- | ---------------------------------- | -------------- |
| First public presence + 3 months                            | **r/selfhosted** standalone posts  | **2026-10-05** |
| First release + 4 months                                    | **awesome-selfhosted**             | **2026-11-05** |
| AlternativeTo account age + 1 week                          | AlternativeTo submission           | account + 7d   |
| Lobsters: domain must have been seen; no `show` tag for 70d | Lobsters                           | invite + 70d   |
| 225★ (self-submission)                                      | Homebrew                           | on stars       |
| 500★ + 150 forks                                            | Scoop **main** (Extras is ungated) | on stars       |
| 1,000★                                                      | Coolify one-click                  | on stars       |

Set these as tripwires in the pipeline's ledger, not as reminders in a human's head.

---

## 1. Hacker News ✅ all verbatim from primary sources

**Write API: none. Automation: structurally impossible and culturally fatal.**

From [newsguidelines.html](https://news.ycombinator.com/newsguidelines.html):

> "Please don't use HN primarily for promotion. It's ok to post your own stuff part of the time, but
> the primary use of the site should be for curiosity."

> "Don't solicit upvotes, comments, or submissions."

> **"Don't post generated text or AI-edited text. HN is for conversation between humans."**

> "Throwaway accounts are ok for sensitive information, but please don't create accounts routinely."

From [showhn.html](https://news.ycombinator.com/showhn.html):

> "Show HN is for something you've made that other people can play with."

> "**The project should be non-trivial. Don't post quickly-generated one-offs; anybody can do that
> now.**"

> "Please make it easy for users to try your thing out, ideally without barriers such as signups."

> "New features and upgrades ('Foo 1.3.1 is out') generally aren't substantive enough."

From the [FAQ `#ring` anchor](https://news.ycombinator.com/newsfaq.html):

> "**We penalize or ban submissions, accounts, and sites that break this rule**, so please don't."

**Moderator posture on AI text, 2026** - dang, [2026-02-17](https://news.ycombinator.com/item?id=47051069):

> "With LLM comments, there's an important distinction between legit users… and **accounts that
> appear to be posting nothing but gen-AI text. If you see a case of the latter, definitely please
> email us because we've been banning those accounts.**" … "we've suspended their account until we
> hear from them that they won't post LLM-generated **or processed** comments."

dang, [2026-06-09](https://news.ycombinator.com/item?id=48455315): _"If people would read the site
guidelines and **not post generated text with their Show HNs**, they'd do a lot better."_

**On promotion that does work** - dang, [item 9213583](https://news.ycombinator.com/item?id=9213583):

> "your best bet is to do a detailed technical writeup of what you've achieved and how. The more
> detail, the better. HN readers love to look under the hood."

**On the penalty** - dang, [item 9831709](https://news.ycombinator.com/item?id=9831709):

> "**Astroturfing accounts get banned, and usually we'll ban the submitters' accounts and the site as
> well.**"

**Detection is human**, not algorithmic: community flags + emailed reports → moderator review. The
trigger is an account-level _pattern_, not a per-post classifier. The voting-ring detector, by
contrast, is automated and fires on timing/graph correlation.

**Recovery:** `hn@ycombinator.com`. Domain unbans and repost invitations are granted routinely -
tylervigen.com was banned purely for being over-submitted (27 times) and later unbanned. The danger is
not the ban; it's not knowing you have one. Check `showdead` / logged-out after every submission.

- **Otto's Show HN eligibility:** ✅ qualifies - installable, runnable, no signup, non-trivial, authored by the poster.
- **Cadence:** one Show HN per major milestone. Retries permitted (see charter Phase 6). Never delete-and-repost.

---

## 2. Reddit

**All rules below marked ✅ were fetched from `support.reddithelp.com` or dated Wayback snapshots.
reddit.com blocks automated reading entirely, so subreddit rules marked ❓ must be read in a browser
before posting.** This is Phase 0.9.

### Sitewide ✅

[Reddit Rules](https://redditinc.com/policies/reddit-rules) Rule 2: _"Participate authentically in
communities where you have a personal interest, and do not spam or engage in disruptive behaviors
(including content manipulation)."_

[Spam policy](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam) (updated
2026-05-19): never allowed - _"Mass-posting repetitive content for the purpose of exposure or
financial gain… **Using tools (e.g., bots, generative AI tools) that may break Reddit or facilitate
the proliferation of spam.**"_

[Manipulated Content](https://support.reddithelp.com/hc/en-us/articles/41180423371156-Manipulated-Content-and-Misleading-Behavior)
(updated 2026-05-19): AI content is _"generally allowed… subject to each community's specific rules"_
but the policy _"prohibits sharing AI-generated content that… **presents itself as human-generated**.
When posting permissible AI-generated content, be transparent and include a tag."_

[Reddiquette](https://support.reddithelp.com/hc/en-us/articles/205926439-Reddiquette) - the 9:1 rule
survives as documented custom, not enforced policy: _"**A widely used rule of thumb is the 9:1 ratio**,
i.e. only 1 out of every 10 of your submissions should be your own content."_ Also: soliciting votes
_"will result in a ban from the admins."_

**2026 enforcement changes** ([TechCrunch, 2026-03-25](https://techcrunch.com/2026/03/25/reddit-bots-new-human-verification-requirements/)):
human-verification challenges now fire on bot-like signals explicitly including _"how quickly the
account is attempting to write or post content."_ An `[App]` label exists for registered automated
accounts via r/redditdev - unlabeled automation is what's being hunted.

**Domain bans are the maker-killer:** silent, apply regardless of which account posts, and kill every
future submission of otto-code.me. Community-tracked at r/BannedDomains and r/SpammedDomains.
Self-check for shadowban: logged-out view, or r/ShadowBan.

### Per-subreddit

| Sub                                                                                                        | Size / growth     | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Conf. |
| ---------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| **r/selfhosted**                                                                                           | 803K, +44%        | **Rule 6, verbatim:** _"Only in the current 'New Project Megathread,' you may post projects that are younger than 3 months (measured by first public presence, e.g. git commit, social media post, etc.)."_ → **standalone blocked until 2026-10-05.** **Rule 2:** _"Do not spam or promote your own projects too much… Promoted apps must be production ready and have docs… Only mention your service in comments if it's relevant and adds value."_ | ✅    |
| **r/programming**                                                                                          | 6.9M, +1.8%       | **Verbatim:** _"r/programming is not a place to post your project… **Technical writeups on what makes a project technically challenging, interesting, or educational are allowed and encouraged, but just a link to a github page or a list of features is not.**"_ → an essay target, never a project post.                                                                                                                                           | ✅    |
| **r/webdev**                                                                                               | -                 | **Verbatim:** _"Please refer to the Reddit 9:1 rule… **Sharing your project… is limited to Showoff Saturday.** If you post such content on any other day, it will be removed."_                                                                                                                                                                                                                                                                        | ✅    |
| **r/LocalLLaMA**                                                                                           | 778K, +55%        | Self-promo "tolerated but policed"; ~10% activity ceiling; disclose affiliation; open source welcomed, paid gets pushback.                                                                                                                                                                                                                                                                                                                             | 🟡    |
| **r/ClaudeCode**                                                                                           | 358K, **+4,359%** | **Flair required** - use `Showcase` or `Resource`. Fastest-growing relevant sub by a wide margin.                                                                                                                                                                                                                                                                                                                                                      | 🟡    |
| **r/mcp**                                                                                                  | 115K, +152%       | `showcase` is the dominant flair. Reported: launched services allowed, waitlists/landing-pages not.                                                                                                                                                                                                                                                                                                                                                    | 🟡    |
| **r/opensource**                                                                                           | 369K, +32%        | Has a **"Promotional" flair** - the single most-used flair on the sub, so promo is structurally sanctioned.                                                                                                                                                                                                                                                                                                                                            | 🟡    |
| **r/SideProject**                                                                                          | 781K, +80%        | `rules.json` returns an **empty custom-rules array** - norms live in sidebar prose only. Reported: project-context required, vague product posts removed.                                                                                                                                                                                                                                                                                              | 🟡    |
| **r/ClaudeAI**                                                                                             | 1.0M, +269%       | ❓                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ❓    |
| **r/coolgithubprojects**                                                                                   | 109K, +83%        | Stated purpose is literally "Sharing Github projects just got easier!" - underrated.                                                                                                                                                                                                                                                                                                                                                                   | ❓    |
| **r/ollama**, **r/LocalLLM**, **r/ChatGPTCoding**, **r/commandline**, **r/OpenSourceAI**, **r/vibecoding** | 26K–390K          | ❓ - read each sidebar                                                                                                                                                                                                                                                                                                                                                                                                                                 | ❓    |
| **r/openclaw**                                                                                             | 130K, new         | The 2026 story: `openclaw/openclaw` is at 383,485★ since 2025-11-24. Large, self-hosting-sympathetic, didn't exist a year ago. ❓ rules                                                                                                                                                                                                                                                                                                                | ❓    |

**Cadence cap:** max 1 Reddit submission per week, never two in the same sub within 30 days, never
near-identical text across subs, always disclose authorship, always stay in comments 24–48h.

---

## 3. Lobsters ✅

[lobste.rs/about](https://lobste.rs/about):

> "It's great to have authors participate in the community, but not to exploit it as a write-only tool
> for product announcements or driving traffic to their work."

> Self-promotion "should be less than a quarter of one's stories and comments."

Invite-only. **New users cannot submit links to domains the site hasn't seen before** - a fresh
account literally cannot post otto-code.me - and cannot use the `show` tag for **70 days** (also
blocked: `meta`, `rant`, `announce`, `satire`, `job`, `interview`, `ask`, `culture`, `vibecoding`).

Note the existence of a **`vibecoding` tag** - built so members can filter the category _out_. Expect
a cool reception to anything framed that way. Moderator actions are logged publicly and permanently at
[lobste.rs/moderations](https://lobste.rs/moderations) with your username.

**Only viable format:** a technical deep-dive on one hard problem (daemon-enforced browser tab
binding; one agent loop across six providers) - never the README. **Status: effectively blocked for
≥70 days after an invite. Deprioritize.**

---

## 4. Publishing platforms

| Platform                 | Verdict             | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DEV**                  | ✅ **use**          | [Terms](https://dev.to/terms): _"**Posts must contain substantial content - they may not merely reference an external link that contains the full post.**"_ → publish the full body. [CoC](https://dev.to/code-of-conduct) requires **disclosing AI assistance**. Tag cap 4: `#showdev` `#opensource` `#ai` + one language. Set `canonical_url` home. Free write API (`POST /api/articles`, `api-key` header).                                                                                          |
| **Mastodon / Fosstodon** | ✅ **use**          | [Fosstodon rules](https://fosstodon.org/api/v1/instance) (62,695 users, registrations closed): _"**DO NOT post commercial promotions, or advertise**"_ - hinted as link-only posts, excessive hashtags, and _"repetitive self-promotion **for profit**."_ Otto is free/AGPL → inside every clause. Also: _"**DO NOT use automated tools to post without also monitoring and/or interacting from your account.**"_ Set the `bot` flag if automating. ≤3 hashtags. Fallbacks: hachyderm.io, floss.social. |
| **Bluesky**              | ✅ own content only | [Dev guidelines](https://docs.bsky.app/docs/support/developer-guidelines) prohibit _"Generating automated or bulk interactions, including any that would cause a notification to a user like a message, follow, like or reply."_ → posting your own content is fine; **automated replies are not**. Free API. No link suppression (unlike X). Getting added to dev **starter packs** is the highest-leverage action.                                                                                    |
| **X**                    | 🟡 defer            | Pay-per-use since Feb 2026: **$0.005/post read, $0.015/post created, $0.200 per post containing a URL.** No free tier. [Guidelines](https://docs.x.com/developer-guidelines): automated replies only where "the user engaged first," max one per interaction. Since March 2026 non-Premium links get near-zero reach. Video is first-class since the Grok-based ranker shipped in Jan 2026.                                                                                                             |
| **Hashnode**             | ❌ skip             | API [went paid 2026-05-13](https://hashnode.com/changelog/2026-05-13-graphql-api-paid-access); Pro is $5/mo. DEV does everything it does, free.                                                                                                                                                                                                                                                                                                                                                         |
| **Medium**               | ❌ skip             | [Distribution guidelines](https://help.medium.com/hc/en-us/articles/360006362473): self-promotional stories are de-distributed; AI-generated writing is ineligible. Boost nominations closed 2026-05-31. Better Programming on hiatus.                                                                                                                                                                                                                                                                  |
| **daily.dev**            | 🟡 Squad only       | Docs: _"Corporate and personal blogs are not eligible"_ as sources; rejects _"AI-generated content… or content with characteristics typical of AI-generated material."_ Individual path is a Squad.                                                                                                                                                                                                                                                                                                     |
| **LinkedIn**             | ❌ manual           | Posts API needs partner approval, reported 4 weeks–6 months. Not worth it for a solo maker.                                                                                                                                                                                                                                                                                                                                                                                                             |

---

## 5. Launch boards

| Board                                                   | Verdict         | Notes                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **[Dev Hunt](https://devhunt.org)**                     | ✅ **best fit** | GitHub-auth voting (kills ring-voting), weekly cycle, dev-only. Free.                                                                                                                                                                                                                                                                                                                                  |
| **[Peerlist Launchpad](https://peerlist.io/launchpad)** | ✅ good         | Weekly (opens Monday), not a 24h knife fight. Ranks on upvotes + comments + views + **link clicks** - favors things people actually try. Framed by Peerlist as a soft launch for feedback, right shape for pre-1.0.                                                                                                                                                                                    |
| **Product Hunt**                                        | ❌ skip         | [Guidelines](https://help.producthunt.com/en/articles/3615694-community-guidelines): _"Mass messaging users, asking for upvotes, using bots… is not acceptable"_; _"Spammers will also be permanently removed."_ _"Company accounts are prohibited."_ ~3,869 launches in H1 2026 averaging **144 upvotes**; audience is founders/marketers, not daemon-runners. A weak number is permanent and public. |
| **BetaList**                                            | ❌ ineligible   | Requires products "recently launched or still unreleased," a custom-designed landing page, and a **custom email signup**. Otto collects no emails.                                                                                                                                                                                                                                                     |
| **Uneed**                                               | 🟡 low          | Free tier requires a backlink badge on your site; queue "stretches weeks"; $9 to skip.                                                                                                                                                                                                                                                                                                                 |
| Fazier, Launching Next, MicroLaunch, TinyLaunch         | 🟡 batch        | One sitting, near-zero expected traffic, some dofollow links. MicroLaunch's month-long window suits a tool that takes time to install.                                                                                                                                                                                                                                                                 |

---

## 6. Directories

| Directory                                                       | Verdict             | Criteria                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[selfh.st](https://selfh.st)**                                | ✅ **#1**           | Self-Host Weekly publishing (2026-07-17 latest). Form at the bottom of each issue: _"I'm always looking for new and existing self-hosted content to share."_ Site 403s bots - open in a browser.                                            |
| **[AlternativeTo](https://alternativeto.net)**                  | ✅ high             | _"New users must wait a week after the creation of their account."_ Turnaround days–week. Rejects unreleased/closed-beta, deprioritizes "AI wrappers." **The prize is being listed on the Cursor / Claude Code / Zed pages, not your own.** |
| **[SaaSHub](https://www.saashub.com/services/submit)**          | ✅ medium           | Free. _"The submission will be slowed down and put to the bottom of the queue if there are not listed competitors"_ → **list Cursor / Zed / Continue / Aider / OpenHands.**                                                                 |
| **[LibHunt](https://www.libhunt.com/repo/submit)**              | ✅ 60 sec           | Single URL field. Bonus: it monitors _"everything that's posted on Reddit, HackerNews & Dev.to (almost in real-time)"_ - every later post feeds it automatically.                                                                           |
| **[OpenAlternative](https://openalternative.co)**               | 🟡 free only        | Star minimum is **unconfirmed** - About treats stars as a ranking input, not a gate. Paid packages $97–$197/mo: **do not pay**; ~661 monthly visits.                                                                                        |
| **StackShare / Slant / Openbase**                               | ❌                  | Openbase is dead (domain does not resolve). StackShare is a zombie post-FOSSA acquisition. Slant's team pivoted to Vetted.ai.                                                                                                               |
| **[GitHub Trending](https://github.com/trending)** / Trendshift | - nothing to submit | The upstream input to nearly every "AI repo of the week" video and newsletter. Won, not submitted. Trendshift ranks sustained momentum, so a slow burn can chart after falling off Trending.                                                |

---

## 7. Newsletters, YouTube, podcasts

| Target                                                | Route                                                                                                  | Notes                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Changelog News**                                    | [changelog.com/news/submit](https://changelog.com/news/submit)                                         | Verbatim: _"Submitting other people's work is encouraged, as well as **submitting your own work**."_ **The most self-submission-friendly outlet in this report.**                                                                                                     |
| **Console.dev**                                       | `hello@console.dev` (no form)                                                                          | 30,000+ devs. Their [criteria](https://console.dev/selection-criteria) are Otto's spec: self-service, no sales call, multi-platform, docs, power-user features. [Betas section](https://console.dev/betas/) takes pre-1.0. _"Console does not do sponsored reviews."_ |
| **TLDR** (7.2M)                                       | `submissions@tldr.tech`                                                                                | Target TLDR AI and TLDR Web Dev.                                                                                                                                                                                                                                      |
| **Hacker Newsletter** (60K)                           | none - hand-curated from HN                                                                            | Won by ranking on HN. Reinforces HN as the upstream lever.                                                                                                                                                                                                            |
| **Pragmatic Engineer** (1M+)                          | `pulse@pragmaticengineer.com`                                                                          | Covers trends, not launches. Pitch the trend, Otto as the example.                                                                                                                                                                                                    |
| **Latent Space** (200K)                               | [about page](https://www.latent.space/about): _"we do not accept cold emails."_ Guest-post form exists | Warm intro required. Highest value, slowest path. Their Discord is the on-ramp - which is why a bad drop there is expensive.                                                                                                                                          |
| **Ben's Bites**                                       | community submissions at [news.bensbites.com](https://news.bensbites.com/)                             | Verify the flow still exists                                                                                                                                                                                                                                          |
| **Import AI**                                         | -                                                                                                      | ❌ wrong format (research/policy)                                                                                                                                                                                                                                     |
| **IndyDevDan** (~136K)                                | business email in About                                                                                | **#1 YouTube target.** Entire channel is agentic coding - Claude Code stacks, MCP, subagents, agent teams. Otto is native content.                                                                                                                                    |
| **Matt Williams** (@technovangelist)                  | business email                                                                                         | Founding **Ollama** maintainer - highest-credibility endorsement available for the local-model half of the pitch.                                                                                                                                                     |
| **GosuCoder**                                         | business email                                                                                         | Does head-to-head agent benchmarking. Exactly who reviews a new coding agent - and the natural home for the Phase 4 benchmark.                                                                                                                                        |
| **Cole Medin**, **AICodeKing**, **Digital Spaceport** | business email                                                                                         | Local-AI stacks / daily new-tool coverage / homelab                                                                                                                                                                                                                   |
| **Fireship** (4.2M)                                   | doesn't take pitches                                                                                   | Winning the HN front page is the actual path.                                                                                                                                                                                                                         |
| **The Changelog / Practical AI**                      | [changelog.com/request](https://changelog.com/request)                                                 | Best-fit network by a mile. **Get on Changelog News first, then request an episode.**                                                                                                                                                                                 |
| **Syntax**                                            | [syntax.fm/potluck](https://syntax.fm/potluck)                                                         | Cheapest legitimate shot on the board - a well-framed question gets Otto named on a large show.                                                                                                                                                                       |

**Pitch shape:** one paragraph, a 30-second clip, repo link, hook pre-written. Never a feature list.
Never offer money - their value is that they aren't sponsored.

---

## 8. Discord / forums

**No Discord's rules could be read - they are auth-gated.** Member counts are third-party scrapes,
±20%. Anyone claiming to have read a Discord's promo policy from the web is guessing.

**Otto's posture: Discord is write-only, in servers we've earned standing in. No listening anywhere.**
Automated user accounts are a ban-on-detection offense, and the Developer Policy prohibits using
message content to train or feed models without permission.

| Server                   | Members 🟡 | Note                                                                                                                                                                                                                                                 |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenCode** (Anomaly)   | ~66K       | [SST wrote publicly](https://sst.dev/blog/moving-to-discord/) about choosing Discord to support OSS communities - culturally the most OSS-friendly                                                                                                   |
| **Zoo Code**             | new        | [discord.gg/VxfP4Vx3gX](https://discord.gg/VxfP4Vx3gX) via [zoocode.dev](https://www.zoocode.dev/). Roo Code archived 2026-05-15 at 24,362★; this fork has 1,367★ and a "help us keep this alive" posture. **Most under-served target on the list.** |
| **LM Studio**            | ~80.5K     | Direct fit                                                                                                                                                                                                                                           |
| **Ollama**               | ~197K      | Direct fit                                                                                                                                                                                                                                           |
| **Claude (Anthropic)**   | ~115K      | Their [community page](https://claude.com/community) describes it as "Real-time help, **project sharing**, and active discussions"                                                                                                                   |
| **OpenRouter**           | ~49.8K     | Forum-type `#help` channel - much safer than general chat                                                                                                                                                                                            |
| **Aider**                | ~10.4K     | Terminal-agent culture, closest philosophically                                                                                                                                                                                                      |
| **Cline**, **Kilo Code** | 23K / 15K  | Verify Kilo's invite - an open issue reports it invalid                                                                                                                                                                                              |
| **Latent Space**         | ~10.6K     | Smallest, highest-signal room in the space. These people write the newsletters and run the podcasts. **Go last.**                                                                                                                                    |
| **Zed**                  | ~28K       | **Highest reputational risk** - Otto is a rival editor. Skip.                                                                                                                                                                                        |

**There is no official r/LocalLLaMA Discord.** Servers claiming the name are third-party.

**Zero-etiquette-risk front doors - do these instead of cold Discord drops:**

- **Anthropic project submission:** [form.typeform.com/to/VIUAjxNi](https://form.typeform.com/to/VIUAjxNi) - official, "for potential feature on Claude's social channels."
- **OpenAI [Codex for Open Source](https://developers.openai.com/community/codex-for-oss)** and [Codex Ambassadors](https://developers.openai.com/community/codex-ambassadors).

**Forums beat Discord for a solo maker** - indexed, permanent, searchable:
[community.openai.com](https://community.openai.com/) (Codex category) ·
[GitHub Copilot Conversations](https://github.com/orgs/community/discussions/categories/copilot-conversations) ·
[discuss.huggingface.co](https://discuss.huggingface.co/) · [forum.cursor.com](https://forum.cursor.com)

**Cadence:** join five, lurk a week, read `#rules`, post in at most two. ≤2 servers/week. Always a
designated channel, always a clip + repo link + one genuine technical detail, stay 48h, never reuse
wording. Realistic failure mode is not a ban - it's silent deletion, a mod DM, and the durable label
"the guy who spams his IDE" in a small set of overlapping communities.

---

## 9. Competitive context (kept current, feeds positioning)

| Project                 | Stars (2026-07-19) | State                                                                 |
| ----------------------- | ------------------ | --------------------------------------------------------------------- |
| openclaw/openclaw       | **383,485**        | The 2026 story; created 2025-11-24                                    |
| anomalyco/opencode      | **187,496**        | Category leader; MIT                                                  |
| anthropics/claude-code  | 138,330            | Shipped mobile Remote Control 2026-02-24                              |
| zed-industries/zed      | 87,245             | Rival editor - do not post in their spaces                            |
| cline/cline             | 64,814             | Shipped mobile + Kanban orchestration in 2026                         |
| Aider-AI/aider          | 47,514             | **Stalling** - last push 2026-05-22; leaderboard stale since Nov 2025 |
| continuedev/continue    | 34,970             | **Frozen** - "no longer actively maintained… read-only"               |
| voideditor/void         | 28,856             | **Archived** 2026-06-02                                               |
| RooCodeInc/Roo-Code     | 24,362             | **Archived** 2026-05-15 → diaspora at Zoo Code                        |
| **getpaseo/paseo**      | **10,864**         | Upstream. Active. A realistic ceiling for this niche.                 |
| **Draek2077/otto-code** | **1**              | Public 14 days                                                        |

**The 2026 shift that matters most:** Anthropic's January–February enforcement against third-party
OAuth reuse. OpenCode's PR literally titled ["anthropic legal requests"](https://github.com/anomalyco/opencode/pull/18186)
(544 downvote reactions) preceded a 1,274-point HN thread and a vertical star climb. Provider-neutrality
became a hedge rather than a feature. **That is Otto's exact thesis - the market moved toward us.**
Have the essay written before the next incident, not after.

---

## Companion document: content.md

# Content: assets, copy shapes, calendar

What gets made, in what order, and what each channel expects. Positioning and the message house live
in [outreach.md](outreach.md) §3; this file is the production plan.

---

## 1. The asset library

Everything below is produced by the existing `site-demos` pipeline (`packages/app/demo/`, Playwright,
2560×1440, both Twilight and Daylight themes, MP4/WebM + PNG + `manifest.json`, no GIF). The pipeline
exists and works; **the website consumes none of its output yet** - that gap is Phase 0.3.

| #   | Asset                     | Spec                                                                                                                                          | Used by                                                  |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A1  | **The parity clip**       | 40s. Same task, same repo, same browser-verified preview - Claude first, then a local LM Studio model. Payoff visible in the first 2 seconds. | Everything. Landing page, every post, every pitch        |
| A2  | Multi-provider split pane | 20s. Two providers, one workspace, side by side.                                                                                              | r/LocalLLaMA, LM Studio, Ollama                          |
| A3  | Preview verification      | 25s. Agent starts the dev server, changes code, screenshots the result, shows proof.                                                          | HN brief, DEV article, Console.dev                       |
| A4  | Personalities & teams     | 20s. Named agents with roles and colors; one spawning another.                                                                                | r/ClaudeCode, Anthropic form                             |
| A5  | Phone continuation        | 15s. Desk → phone, same session. **Supporting, never the lead** (see [outreach.md](outreach.md) §2a).                                         | Store listings, mobile-adjacent subs                     |
| A6  | Subagent accounting       | 20s. Real per-subagent token/cost rows.                                                                                                       | The benchmark post, r/mcp                                |
| A7  | Stills                    | Hero, split panes, personalities, changes view - both themes                                                                                  | Directories, press kit, store cards                      |
| A8  | Press kit                 | `/press`: one-line + one-paragraph descriptions, logo pack, A1, stills, honest limitations, contact                                           | Every Phase 1 submission and Phase 6 pitch               |
| A9  | Docker Compose snippet    | Copy-pasteable, in the README                                                                                                                 | **Effectively required** by r/selfhosted, homelab stores |
| A10 | Benchmark result page     | Phase 4. Methodology, reproducible harness, raw JSON/CSV, permanent URL.                                                                      | The citable artifact                                     |

**A1 is the single most important thing this project produces.** It is the only asset that
demonstrates the wedge in a form that survives being screenshotted into someone else's thread.

---

## 2. Copy shapes per channel

Length, required fields, and the trap for each. The pipeline enforces these
([pipeline.md](pipeline.md) §4).

| Channel                | Shape                                                                                                    | Required                                                    | Trap                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| **Hacker News**        | Title = the claim, not the product. Maker comment in minute 1: what, why, stack, **honest limitations**. | Human-written, top to bottom                                | Any AI-generated _or AI-edited_ text. Soliciting votes.     |
| **r/selfhosted**       | Screen-recorded clip → what it is → Compose snippet → GitHub link → "I built this"                       | A9, docs, production-ready claim                            | Standalone posts blocked until 2026-10-05 - megathread only |
| **r/LocalLLaMA**       | Comparison framing: "same harness against LM Studio vs Claude - here's what breaks"                      | Disclose affiliation                                        | Reads as a product ad rather than a finding                 |
| **r/ClaudeCode**       | Showcase with A1 + A4                                                                                    | **Flair: `Showcase` or `Resource`**                         | Posting without flair = auto-removal                        |
| **r/programming**      | **Technical writeup only** - never a project post                                                        | Substance about a hard problem                              | "Just a link to a github page or a list of features"        |
| **DEV**                | **Full article body on DEV** (linking out violates their terms)                                          | `canonical_url` home, ≤4 tags, **AI-assistance disclosure** | Teaser-plus-link                                            |
| **Mastodon/Fosstodon** | Real post with context, ≤3 hashtags                                                                      | Never a bare link                                           | Link-only posts and hashtag stuffing trip their ad rule     |
| **Bluesky**            | Native video first, link in a reply                                                                      | Own content only                                            | Any automated reply causes a notification → prohibited      |
| **Directories**        | Objective one-liner, no emoji, no second person, no "open-source/free/self-hosted" filler                | `(fork of Paseo)` where the list has a fork convention      | Sales-pitch phrasing gets rejected on sight                 |
| **Newsletter pitch**   | One paragraph + A1 + repo link + pre-written hook                                                        | The hook, not a feature list                                | Sending a feature list                                      |
| **YouTube pitch**      | Subject = the claim. Three sentences. Never offer money.                                                 | A1                                                          | Anything that reads as a sponsorship approach               |

### The hook, pre-written

> A solo maker gave a local LM Studio model the same harness Anthropic gives Claude - browser-verified
> previews, subagent visibility, MCP, compaction. Here's what broke and what didn't.

Benchmarkable, filmable, and true. Use it in every pitch.

---

## 3. The three Phase 0 blog posts

The blog system works (`packages/website/posts/`, drafts hidden unless `?drafts`) and has **zero
published posts**. Every Phase 1 submission points at a site whose blog is empty. These three fix
that, and each does double duty as a channel asset.

1. **"Giving a local model the frontier harness"**: the parity thesis, with A1 embedded and the
   engineering detail underneath: how preview verification, subagent observation, and compaction were
   made provider-neutral. This is the Console.dev and Show HN backbone.
2. **"What happens when your provider changes the rules"**: the independence argument.
   Deliberately written _before_ it is needed: OpenCode gained ~18,000 stars in two weeks when
   Anthropic blocked it, and the next such incident will happen. Must state precisely how Otto talks
   to Claude (see [runbook.md](runbook.md) §1).
3. **"Proof, not 'should work now'"**: the preview subsystem as a design argument about agents that
   verify their own work. The most technically interesting thing in the repo, and the one most likely
   to survive a Lobsters or r/programming audience.

Publish on otto-code.me, cross-post full text to DEV with `canonical_url` home, submit each to
Changelog News.

---

## 4. Editorial calendar

Cadence: **one substantial piece every 2–3 weeks.** The Cline lesson is that the argument is the
marketing and the product is the proof - and that is a strategy a solo maker can actually sustain,
because it is writing rather than spend. It is also the entire supply line for Changelog News,
Console.dev, Pointer.io, Pragmatic Engineer, and r/programming.

| Slot | Piece                                                 | Feeds                                            |
| ---- | ----------------------------------------------------- | ------------------------------------------------ |
| 1    | Giving a local model the frontier harness             | Phase 0 gate, Console.dev, Changelog News        |
| 2    | Proof, not "should work now"                          | Phase 0 gate, DEV `#showdev`                     |
| 3    | What happens when your provider changes the rules     | Phase 0 gate; held ready for the next incident   |
| 4    | Six providers, one agent loop - what actually differs | r/programming (technical-writeup rule), Lobsters |
| 5    | **Benchmark v1** (Phase 4)                            | The citable artifact; GosuCoder; HN              |
| 6    | Otto runs its own outreach                            | The dogfooding story; DEV; the pipeline as proof |
| 7    | Show HN companion writeup                             | Phase 6                                          |

**Rule: never publish on a schedule you cannot hold.** Directories drop inactive projects
(awesome-selfhosted at 6–12 months, daily.dev at 3), and the Aider/Void failure mode is maintainer
attrition, not bad marketing. If a choice arises between shipping code and shipping a post, ship the
code - visible shipping is itself a distribution channel.

---

## 5. Things to say every time

- **"Otto is a fork of [Paseo](https://github.com/getpaseo/paseo)"**: first, unprompted, every time.
- **The honest gaps**: macOS builds are unsigned (Gatekeeper friction, no auto-update), no iOS,
  Play internal-track only. Volunteering these defuses them; being caught omitting them costs the
  thread.
- **How Otto talks to Claude**: the approved phrasing in [runbook.md](runbook.md) §1, verbatim.
- **"I built this"**: the maker voice is the whole strategy. Never the passive corporate register.

---

## Companion document: pipeline.md

# The pipeline: AI automation architecture

What the machine does, what it must never do, and how it is built.

The design premise, from [outreach.md](outreach.md) §4: **the queue is not a send button. It is a rate
governor and a give:take ledger.** 2026 enforcement on every platform fires on velocity and pattern,
not on whether a human clicked. A system that lets you approve twenty items and fire them in ten
minutes is more dangerous than no automation at all.

---

## 1. Package layout

`packages/outreach/` - a new workspace package, **fully separate**, per [outreach.md](outreach.md) §5.

```
packages/outreach/
  src/
    watch/          # listeners: hn.ts, github.ts, rss.ts, bluesky.ts, inbox.ts
    dossier/        # channels.yml + loader + staleness checks
    draft/          # message house → channel-shaped drafts
    governor/       # cadence caps, give:take ledger, jitter, tripwires
    queue/          # the review store (JSON on disk) + static review UI
    signal/         # daily measurement snapshots
    cli.ts          # otto-outreach watch | draft | queue | snapshot | check
  data/             # committed: ledger.json, signal/*.csv, queue/*.json
  channels.yml      # the machine-readable dossier
```

**Hard constraint:** zero imports from `@otto-code/protocol`, `server`, `app`, `client`,
`visualizer`. It must be extractable to its own repo by moving the folder and deleting one workspace
entry. Nothing here ever ships in a release artifact.

**State is committed to the repo**, deliberately: the ledger and the signal CSVs are the memory of the
system, they are small, they benefit from history, and a repo that receives a daily commit never trips
GitHub's 60-day scheduled-workflow auto-disable.

---

## 2. Listening: only what is free and in-ToS

| Source               | Method                                                                                                                         | Status                                                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hacker News**      | [Algolia](https://hn.algolia.com/api) `search_by_date` + `numericFilters=created_at_i>{last}`, plus Firebase `/updates`        | ✅ no key, no auth, ~10K req/hr; Firebase states "no rate limit"                                                                                                                                                                                                                                        |
| **GitHub**           | `/search/issues?q=<kw>+in:body`, `/notifications`, repo Events, `releases.atom`                                                | ✅ explicitly not scraping per their AUP; 5,000 req/hr authenticated                                                                                                                                                                                                                                    |
| **RSS**              | YouTube channels (`feeds/videos.xml?channel_id=`), Lobsters tags, GitHub releases/commits, Mastodon profiles, competitor blogs | ✅ unambiguously fine, no keys                                                                                                                                                                                                                                                                          |
| **Bluesky**          | [Jetstream](https://docs.bsky.app/blog/jetstream) filtered to `app.bsky.feed.post`, keyword match locally                      | ✅ free, self-hostable, no app review                                                                                                                                                                                                                                                                   |
| **Reddit**           | **[F5Bot](https://f5bot.com) → email → parsed inbox**                                                                          | ⚠️ **do not build against the Reddit API.** Self-service OAuth registration closed Nov 2025; unauthenticated `.json` returns 403 since May 2026; RSS throttled to ~1/min June 2026. Buy (or free-tier) the listening rather than fight the approval process. Alternative: [Syften](https://syften.com). |
| **Discord**          | **none**                                                                                                                       | 🔴 not built. Listening in servers we don't own is ToS-prohibited in substance; automated user accounts are ban-on-detection.                                                                                                                                                                           |
| **X**                | **none**                                                                                                                       | 🔴 $0.005/read with no free tier. Not worth it.                                                                                                                                                                                                                                                         |
| **YouTube Data API** | **none** - use channel RSS instead                                                                                             | ⚠️ `search.list` was cut to **100 calls/day** on 2026-06-01                                                                                                                                                                                                                                             |

**Design note:** every listener writes normalized `Signal` records to one store. Keyword sets live in
`channels.yml`, not in code - competitors, category terms, and Otto's own names, tracked separately so
"someone mentioned Otto" and "someone asked a question Otto answers" are different triggers.

---

## 3. The dossier gate

`channels.yml` is the machine-readable form of [channels.md](channels.md). Each entry carries:

```yaml
- id: reddit/selfhosted
  rules_verified_at: 2026-07-19
  rules_source: primary # primary | secondary | unverified
  eligible_from: 2026-10-05 # rule 6: projects <3mo → megathread only
  requires: [flair?, disclosure, docs, production_ready]
  cadence: { max_per: 30d, min_gap_days: 30 }
  format: [demo_clip, repo_link, compose_snippet]
  forbidden: [link_only, cross_post_duplicate]
```

**The gate:** the drafter refuses to produce anything for a channel where
`rules_source: unverified`, where `rules_verified_at` is older than 90 days, or where `eligible_from`
is in the future. It emits a task for the human instead: _"read this sidebar."_ This is what turns
Phase 0.9 from a good intention into a build-time dependency.

---

## 4. Drafting: and the line it must not cross

The drafter composes from the message house and asset library in [content.md](content.md), shaping
per channel: length, required flair/tags, disclosure string, canonical URL, and which clip.

**Every draft carries a provenance banner** naming the channel's AI rule:

| Channel                     | Banner                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hacker News, Lobsters       | 🔴 **DO NOT PASTE. Rewrite from scratch in your own words. AI-_edited_ text is banned too.** This draft is a briefing: facts, links, anticipated objections. |
| Reddit                      | 🟡 Rewrite substantially, or post as-is **with an AI-assistance tag** per Reddit's May 2026 policy                                                           |
| DEV                         | 🟡 AI-assistance disclosure required by their CoC                                                                                                            |
| Mastodon, Bluesky, own blog | 🟢 Editable draft; you must still read and own every word                                                                                                    |

For HN and Lobsters the deliverable is **explicitly not copy**. It is a brief: the technical detail
worth leading with, the three objections that will come up, the honest limitations to volunteer, and
the links. dang's stated advice - _"a detailed technical writeup… the more detail, the better"_ - is
something only the person who built it can write.

**Never drafted at all:** replies in live threads, DMs, anything addressed to a named individual.

---

## 5. The governor: the part that actually matters

Runs between drafter and queue. A draft that fails any check does not reach the human.

**Cadence caps** (per `channels.yml`): default ≤1 Reddit submission/week, ≥30 days between posts in
the same sub, ≤2 Discord servers/week, ≤1 HN submission per milestone.

**Give:take ledger.** Every outbound item is classified `give` (a substantive contribution that does
not mention Otto - answering someone's question, filing a bug upstream, reviewing a PR, writing
something useful) or `take` (mentions Otto). **The governor refuses to release a `take` for a channel
whose running ratio is under 9:1.** Reddit's Reddiquette names 9:1 explicitly; Lobsters says
self-promo should be "less than a quarter"; HN says "the primary use of the site should be for
curiosity." Encoding it in software is the difference between a rule you remember and a rule that
holds.

**Send jitter.** Approved items are released on a randomized schedule, never in a batch. Reddit's
human-verification explicitly keys on _"how quickly the account is attempting to write or post
content."_ The governor enforces a minimum inter-send gap globally, not just per channel.

**Duplicate-text detection.** Refuses near-identical bodies across channels - the classic
cross-posting trigger, and the thing moderators pattern-match fastest.

**Tripwires.** Watches the star/date gates from [channels.md](channels.md) §0 and surfaces a channel
the day it unblocks (awesome-selfhosted on 2026-11-05, r/selfhosted on 2026-10-05, Homebrew at 225★,
Coolify at 1,000★).

**Kill switch.** One flag halts all outbound. Used the moment anything in §7 fires.

---

## 6. Where it runs: recommendation

**Otto runs its own outreach.** A `Herald` agent personality on a scheduled agent, using the CLI above
as its toolbelt, producing the review queue as an artifact. Otto already has scheduled agents, MCP,
personalities, and artifacts - this is mostly wiring, and it dogfoods four subsystems at once. It is
also, itself, a story worth telling in Phase 5.

**With a dead-man's switch:** a GitHub Action on `schedule:` that runs `snapshot` daily regardless.
The measurement data is the one thing that cannot be reconstructed later - GitHub discards traffic
data after 14 days. Two known Action gotchas: `schedule:` triggers skew 10–60+ minutes under load, and
scheduled workflows in public repos **auto-disable after 60 days of repository inactivity** (the daily
data commit prevents this by construction).

Secrets: local `.env` for the maker's machine; GitHub environment secrets with required reviewers if
the Action ever writes anywhere. Never in the repo.

---

## 7. Post-send verification: the highest-value telemetry in the system

Both HN and Reddit punish silently. You can post for weeks into a void with no notification.

15 minutes after every send, automatically:

1. **Logged-out fetch** of the submission URL. Missing → shadowban or removal.
2. **HN:** check whether the item is `[dead]` (visible only with `showdead`), and whether it appears
   on `/newest` logged out.
3. **Reddit:** check the post renders logged-out; periodically self-check via r/ShadowBan.
4. **Domain check:** submit nothing, but watch for the pattern where _every_ recent submission of
   otto-code.me is invisible - that is a domain ban, not bad luck.

On failure: fire the kill switch, notify, and **stop posting until diagnosed.** Recovery for HN is
`hn@ycombinator.com`, and dang lifts domain bans routinely - but only if you know to ask.

---

## 8. Measurement

Daily snapshot, appended to CSV, committed:

| Metric                             | Endpoint                                                   | Note                                               |
| ---------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| Unique views + top referrers       | `/repos/{o}/{r}/traffic/views`, `/popular/referrers`       | **14-day retention - snapshot or lose it forever** |
| Stars with timestamps              | `/stargazers` + `Accept: application/vnd.github.star+json` | Cleanest awareness proxy                           |
| Release asset downloads            | `releases[].assets[].download_count`, daily delta          | Cumulative; excludes source tarballs and clones    |
| Clicks per channel                 | own `/go?c=` redirector logs                               | The only real attribution                          |
| npm, Docker pulls, Discord members | registry APIs                                              | Trend only - CI-inflated                           |

**Why the redirector is not optional:** GitHub's traffic API reports **hostnames only** - no paths, no
query strings. `github.com/Draek2077/otto-code?utm_source=reddit` returns nothing useful. Routing
through `otto-code.me/go?c=reddit-selfhosted` → 302 puts the attribution in a log line we own and
collects nothing about the visitor. Browsers now default to `strict-origin-when-cross-origin`, so
expect origin-level referrers (`https://news.ycombinator.com/`) and no thread paths.

**Nothing here touches a user.** No app telemetry, no daemon telemetry - that does not change.

---

## 9. Build order

1. `signal/` + the `/go` redirector + the daily Action - **first**, because the data is perishable and every later phase is measured against a baseline that must exist beforehand.
2. `dossier/` + `channels.yml` - encodes Phase 0.9's hand-verification.
3. `watch/hn` + `watch/github` + `watch/rss` - free, in-ToS, useful immediately.
4. `governor/` + `queue/` - before the drafter, so nothing can bypass it.
5. `draft/` - last. It is the least important component; the governor and the dossier are what make the system safe, and the human is what makes it good.
6. `watch/bluesky`, F5Bot inbox parsing - once the loop is proven.

---

## 10. What this system explicitly cannot do

Stated so the boundary is not eroded by a later "just this once":

- Post anywhere without a human approving that specific item
- Write anything that gets posted to Hacker News or Lobsters
- Reply to any human, anywhere
- Vote, like, follow, or star anything
- Operate a second account
- Read Discord servers we don't own
- Solicit engagement of any kind

---

## Companion document: runbook.md

# Runbook

Operational playbook. Read [outreach.md](outreach.md) for why; this is what to do.

---

## 1. Approved phrasing: use verbatim

### How Otto talks to Claude

> Otto drives the official Claude Code Agent SDK using your own credentials on your own machine. It
> does not proxy, reuse, or spoof OAuth tokens from Claude Free, Pro, or Max accounts.

**Why this matters:** Anthropic clarified in February 2026 that using Claude subscription OAuth
tokens in third-party products is not permitted, and enforced it against OpenCode - whose removal PR
was literally titled ["anthropic legal requests"](https://github.com/anomalyco/opencode/pull/18186)
and drew 544 downvote reactions and a 1,274-point HN thread. This audience watched it happen and will
check. Sloppy wording here turns a good thread into a hostile one.

### The fork

> Otto is a fork of [Paseo](https://github.com/getpaseo/paseo) - everything Paseo does, plus a mission
> on top: bring frontier-model tooling to every provider equally, cloud and local alike.

Say it first, unprompted, every time. Never a comparison that disparages upstream.

### The gaps

> macOS builds are unsigned - no Apple Developer account - so you have to get past Gatekeeper on
> first launch and they don't auto-update. No iOS build for the same reason. Windows, Linux,
> Android APK, and the web app all ship normally. If you can help with Apple signing, get in touch.

### Disclosure, where a channel requires it

- **Reddit** (policy updated 2026-05-19, AI content must not "present itself as human-generated"):
  tag AI-assisted content.
- **DEV** (Code of Conduct): disclose AI assistance.
- **Any post mentioning Otto anywhere:** "disclosure: I built this."
- **Hacker News and Lobsters:** no AI text at all, so nothing to disclose - just don't.

---

## 2. Pre-send checklist

Run for every outbound item. The pipeline enforces items 1–6 automatically; 7–12 are human.

1. ☐ Channel's `rules_verified_at` is under 90 days old and `rules_source: primary`
2. ☐ Channel is past its `eligible_from` gate ([channels.md](channels.md) §0)
3. ☐ Cadence cap not exceeded; ≥30 days since the last post in this specific community
4. ☐ Give:take ledger is in credit (≥9:1) for this channel
5. ☐ Body is not near-identical to anything sent elsewhere
6. ☐ Links route through `otto-code.me/go?c=<channel>`
7. ☐ **For HN/Lobsters: written by hand, from scratch, not AI-edited**
8. ☐ Required flair / tags / canonical URL present
9. ☐ Fork credit present
10. ☐ Honest limitations stated
11. ☐ Claude phrasing verbatim if Claude is mentioned
12. ☐ I have 24–48 hours available to stay in the thread

**If 12 is false, do not send.** Author responsiveness is the single largest determinant of outcome
in every community in this plan.

---

## 3. Send discipline

- **One account. Yours. Never a second, never an alt, never a "project account" posting alongside it.**
  Multiple accounts touching one domain is the strongest astroturf signal on every platform.
- **Never solicit** upvotes, comments, stars, or shares - including in the Discord, including from
  friends. HN's voting-ring detector fires automatically and the penalty ladder is
  submission → account → **domain**.
- **Spread sends.** Never fire an approved batch at once. Reddit's human-verification keys explicitly
  on how quickly an account attempts to write.
- **Never delete and repost** on HN - it forfeits the [second-chance pool](https://news.ycombinator.com/pool).
  Reposting later, without deleting, is fine and often works (Void: 13 points → 347 points, five days
  apart, same author).
- **Give before you take.** File the upstream bug, answer the unrelated question, review the PR. The
  ledger is not paperwork; it is the thing that makes the eventual post land.

---

## 4. Post-send verification: do this every time

15 minutes after sending, **logged out or in a private window**:

| Platform | Check                                                                                             | Bad sign                                     |
| -------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| HN       | Item visible logged-out; appears on `/newest`. Enable `showdead` on your profile to see `[dead]`. | `[dead]`, or invisible logged-out            |
| Reddit   | Post renders logged-out; periodically self-check via r/ShadowBan                                  | 404 logged-out                               |
| Any      | Pattern across several recent submissions of otto-code.me                                         | **All invisible → domain ban, not bad luck** |

**On any bad sign: fire the kill switch and stop posting until diagnosed.** Continuing to post while
shadowbanned deepens the pattern and wastes weeks.

---

## 5. Incident response

| Situation                         | Action                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HN domain ban suspected**       | Email `hn@ycombinator.com`. Plain, honest, no arguing. dang lifts domain bans routinely - tylervigen.com was banned purely for over-submission and later unbanned. **The ban is recoverable; not knowing about it is not.** |
| **HN post killed / flagged**      | Do not delete. Do not repost immediately. Email hn@ if it looks like a mistake; otherwise let it go and try again later with better framing.                                                                                |
| **Reddit shadowban**              | Stop all Reddit activity. Check r/ShadowBan. Appeal via support. Do not create another account - ban evasion escalates it to sitewide.                                                                                      |
| **Subreddit removal / mod DM**    | Apologize once, briefly, ask what the right channel is, comply. Do not argue. Mods talk to each other.                                                                                                                      |
| **Accused of astroturfing**       | Respond once, plainly, with the facts: one account, no vote solicitation, disclosure in every post. Do not litigate. Then leave the thread.                                                                                 |
| **Someone notices the fork late** | This should be impossible if §1 is followed. If it happens: acknowledge immediately, link Paseo, state what Otto adds. Never defensive.                                                                                     |
| **A provider changes its rules**  | The essay is already written ([content.md](content.md) §3, piece 3). Publish it, don't celebrate, and be accurate about what actually changed.                                                                              |
| **A post goes unexpectedly well** | Stay in the thread. Answer everything. Do not cross-post the success elsewhere. Do not launch anything else that week.                                                                                                      |

---

## 6. Weekly loop

Fifteen minutes, once a week:

1. Review the queue - approve, edit, or reject. Rejecting is normal.
2. Read what the watchtower surfaced. Most items are `give` opportunities, not `take` ones.
3. Check the signal CSV: stars, unique views, top referrer, download delta.
4. Check tripwires - has anything unblocked?
5. Confirm the dossier has no channel gone stale past 90 days.

## 7. Quarterly

- Re-verify every channel's rules from primary sources. This space changed four times in H1 2026.
- Re-check the competitive table in [channels.md](channels.md) §9 - projects archive fast.
- Re-read the positioning in [outreach.md](outreach.md) §3 against what shipped. It has already been
  overtaken once (mobile, February 2026); assume it will happen again.

---

## 8. The one-line test

Before anything goes out, ask: **would I be comfortable if this exact post, and my entire posting
history, were quoted in a thread accusing me of astroturfing?**

If yes, send it. If not, the problem is not the wording.

## Timeline

- time: "2026-08-08T06:17:57.812Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:57.812Z"
  kind: "evidence"
  summary: "Migrated from `projects/outreach/outreach.md` and the legacy `projects/README.md` ledger. Legacy status: Charter. Ledger summary: Awareness strategy, website-scoped. Sells nothing. Companions: channels, content, pipeline, runbook"
- time: "2026-08-08T06:19:49.627Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
