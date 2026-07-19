# Channel dossier

Every target, its **verbatim** rules, gates, and cadence cap. This file is the input the pipeline
reads before drafting anything (see [pipeline.md](pipeline.md) §3) — a channel with no verified rule
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

**Moderator posture on AI text, 2026** — dang, [2026-02-17](https://news.ycombinator.com/item?id=47051069):

> "With LLM comments, there's an important distinction between legit users… and **accounts that
> appear to be posting nothing but gen-AI text. If you see a case of the latter, definitely please
> email us because we've been banning those accounts.**" … "we've suspended their account until we
> hear from them that they won't post LLM-generated **or processed** comments."

dang, [2026-06-09](https://news.ycombinator.com/item?id=48455315): _"If people would read the site
guidelines and **not post generated text with their Show HNs**, they'd do a lot better."_

**On promotion that does work** — dang, [item 9213583](https://news.ycombinator.com/item?id=9213583):

> "your best bet is to do a detailed technical writeup of what you've achieved and how. The more
> detail, the better. HN readers love to look under the hood."

**On the penalty** — dang, [item 9831709](https://news.ycombinator.com/item?id=9831709):

> "**Astroturfing accounts get banned, and usually we'll ban the submitters' accounts and the site as
> well.**"

**Detection is human**, not algorithmic: community flags + emailed reports → moderator review. The
trigger is an account-level _pattern_, not a per-post classifier. The voting-ring detector, by
contrast, is automated and fires on timing/graph correlation.

**Recovery:** `hn@ycombinator.com`. Domain unbans and repost invitations are granted routinely —
tylervigen.com was banned purely for being over-submitted (27 times) and later unbanned. The danger is
not the ban; it's not knowing you have one. Check `showdead` / logged-out after every submission.

- **Otto's Show HN eligibility:** ✅ qualifies — installable, runnable, no signup, non-trivial, authored by the poster.
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
2026-05-19): never allowed — _"Mass-posting repetitive content for the purpose of exposure or
financial gain… **Using tools (e.g., bots, generative AI tools) that may break Reddit or facilitate
the proliferation of spam.**"_

[Manipulated Content](https://support.reddithelp.com/hc/en-us/articles/41180423371156-Manipulated-Content-and-Misleading-Behavior)
(updated 2026-05-19): AI content is _"generally allowed… subject to each community's specific rules"_
but the policy _"prohibits sharing AI-generated content that… **presents itself as human-generated**.
When posting permissible AI-generated content, be transparent and include a tag."_

[Reddiquette](https://support.reddithelp.com/hc/en-us/articles/205926439-Reddiquette) — the 9:1 rule
survives as documented custom, not enforced policy: _"**A widely used rule of thumb is the 9:1 ratio**,
i.e. only 1 out of every 10 of your submissions should be your own content."_ Also: soliciting votes
_"will result in a ban from the admins."_

**2026 enforcement changes** ([TechCrunch, 2026-03-25](https://techcrunch.com/2026/03/25/reddit-bots-new-human-verification-requirements/)):
human-verification challenges now fire on bot-like signals explicitly including _"how quickly the
account is attempting to write or post content."_ An `[App]` label exists for registered automated
accounts via r/redditdev — unlabeled automation is what's being hunted.

**Domain bans are the maker-killer:** silent, apply regardless of which account posts, and kill every
future submission of otto-code.me. Community-tracked at r/BannedDomains and r/SpammedDomains.
Self-check for shadowban: logged-out view, or r/ShadowBan.

### Per-subreddit

| Sub                                                                                                        | Size / growth     | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Conf. |
| ---------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| **r/selfhosted**                                                                                           | 803K, +44%        | **Rule 6, verbatim:** _"Only in the current 'New Project Megathread,' you may post projects that are younger than 3 months (measured by first public presence, e.g. git commit, social media post, etc.)."_ → **standalone blocked until 2026-10-05.** **Rule 2:** _"Do not spam or promote your own projects too much… Promoted apps must be production ready and have docs… Only mention your service in comments if it's relevant and adds value."_ | ✅    |
| **r/programming**                                                                                          | 6.9M, +1.8%       | **Verbatim:** _"r/programming is not a place to post your project… **Technical writeups on what makes a project technically challenging, interesting, or educational are allowed and encouraged, but just a link to a github page or a list of features is not.**"_ → an essay target, never a project post.                                                                                                                                           | ✅    |
| **r/webdev**                                                                                               | —                 | **Verbatim:** _"Please refer to the Reddit 9:1 rule… **Sharing your project… is limited to Showoff Saturday.** If you post such content on any other day, it will be removed."_                                                                                                                                                                                                                                                                        | ✅    |
| **r/LocalLLaMA**                                                                                           | 778K, +55%        | Self-promo "tolerated but policed"; ~10% activity ceiling; disclose affiliation; open source welcomed, paid gets pushback.                                                                                                                                                                                                                                                                                                                             | 🟡    |
| **r/ClaudeCode**                                                                                           | 358K, **+4,359%** | **Flair required** — use `Showcase` or `Resource`. Fastest-growing relevant sub by a wide margin.                                                                                                                                                                                                                                                                                                                                                      | 🟡    |
| **r/mcp**                                                                                                  | 115K, +152%       | `showcase` is the dominant flair. Reported: launched services allowed, waitlists/landing-pages not.                                                                                                                                                                                                                                                                                                                                                    | 🟡    |
| **r/opensource**                                                                                           | 369K, +32%        | Has a **"Promotional" flair** — the single most-used flair on the sub, so promo is structurally sanctioned.                                                                                                                                                                                                                                                                                                                                            | 🟡    |
| **r/SideProject**                                                                                          | 781K, +80%        | `rules.json` returns an **empty custom-rules array** — norms live in sidebar prose only. Reported: project-context required, vague product posts removed.                                                                                                                                                                                                                                                                                              | 🟡    |
| **r/ClaudeAI**                                                                                             | 1.0M, +269%       | ❓                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ❓    |
| **r/coolgithubprojects**                                                                                   | 109K, +83%        | Stated purpose is literally "Sharing Github projects just got easier!" — underrated.                                                                                                                                                                                                                                                                                                                                                                   | ❓    |
| **r/ollama**, **r/LocalLLM**, **r/ChatGPTCoding**, **r/commandline**, **r/OpenSourceAI**, **r/vibecoding** | 26K–390K          | ❓ — read each sidebar                                                                                                                                                                                                                                                                                                                                                                                                                                 | ❓    |
| **r/openclaw**                                                                                             | 130K, new         | The 2026 story: `openclaw/openclaw` is at 383,485★ since 2025-11-24. Large, self-hosting-sympathetic, didn't exist a year ago. ❓ rules                                                                                                                                                                                                                                                                                                                | ❓    |

**Cadence cap:** max 1 Reddit submission per week, never two in the same sub within 30 days, never
near-identical text across subs, always disclose authorship, always stay in comments 24–48h.

---

## 3. Lobsters ✅

[lobste.rs/about](https://lobste.rs/about):

> "It's great to have authors participate in the community, but not to exploit it as a write-only tool
> for product announcements or driving traffic to their work."

> Self-promotion "should be less than a quarter of one's stories and comments."

Invite-only. **New users cannot submit links to domains the site hasn't seen before** — a fresh
account literally cannot post otto-code.me — and cannot use the `show` tag for **70 days** (also
blocked: `meta`, `rant`, `announce`, `satire`, `job`, `interview`, `ask`, `culture`, `vibecoding`).

Note the existence of a **`vibecoding` tag** — built so members can filter the category _out_. Expect
a cool reception to anything framed that way. Moderator actions are logged publicly and permanently at
[lobste.rs/moderations](https://lobste.rs/moderations) with your username.

**Only viable format:** a technical deep-dive on one hard problem (daemon-enforced browser tab
binding; one agent loop across six providers) — never the README. **Status: effectively blocked for
≥70 days after an invite. Deprioritize.**

---

## 4. Publishing platforms

| Platform                 | Verdict             | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DEV**                  | ✅ **use**          | [Terms](https://dev.to/terms): _"**Posts must contain substantial content — they may not merely reference an external link that contains the full post.**"_ → publish the full body. [CoC](https://dev.to/code-of-conduct) requires **disclosing AI assistance**. Tag cap 4: `#showdev` `#opensource` `#ai` + one language. Set `canonical_url` home. Free write API (`POST /api/articles`, `api-key` header).                                                                                          |
| **Mastodon / Fosstodon** | ✅ **use**          | [Fosstodon rules](https://fosstodon.org/api/v1/instance) (62,695 users, registrations closed): _"**DO NOT post commercial promotions, or advertise**"_ — hinted as link-only posts, excessive hashtags, and _"repetitive self-promotion **for profit**."_ Otto is free/AGPL → inside every clause. Also: _"**DO NOT use automated tools to post without also monitoring and/or interacting from your account.**"_ Set the `bot` flag if automating. ≤3 hashtags. Fallbacks: hachyderm.io, floss.social. |
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
| **[Peerlist Launchpad](https://peerlist.io/launchpad)** | ✅ good         | Weekly (opens Monday), not a 24h knife fight. Ranks on upvotes + comments + views + **link clicks** — favors things people actually try. Framed by Peerlist as a soft launch for feedback, right shape for pre-1.0.                                                                                                                                                                                    |
| **Product Hunt**                                        | ❌ skip         | [Guidelines](https://help.producthunt.com/en/articles/3615694-community-guidelines): _"Mass messaging users, asking for upvotes, using bots… is not acceptable"_; _"Spammers will also be permanently removed."_ _"Company accounts are prohibited."_ ~3,869 launches in H1 2026 averaging **144 upvotes**; audience is founders/marketers, not daemon-runners. A weak number is permanent and public. |
| **BetaList**                                            | ❌ ineligible   | Requires products "recently launched or still unreleased," a custom-designed landing page, and a **custom email signup**. Otto collects no emails.                                                                                                                                                                                                                                                     |
| **Uneed**                                               | 🟡 low          | Free tier requires a backlink badge on your site; queue "stretches weeks"; $9 to skip.                                                                                                                                                                                                                                                                                                                 |
| Fazier, Launching Next, MicroLaunch, TinyLaunch         | 🟡 batch        | One sitting, near-zero expected traffic, some dofollow links. MicroLaunch's month-long window suits a tool that takes time to install.                                                                                                                                                                                                                                                                 |

---

## 6. Directories

| Directory                                                       | Verdict             | Criteria                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[selfh.st](https://selfh.st)**                                | ✅ **#1**           | Self-Host Weekly publishing (2026-07-17 latest). Form at the bottom of each issue: _"I'm always looking for new and existing self-hosted content to share."_ Site 403s bots — open in a browser.                                            |
| **[AlternativeTo](https://alternativeto.net)**                  | ✅ high             | _"New users must wait a week after the creation of their account."_ Turnaround days–week. Rejects unreleased/closed-beta, deprioritizes "AI wrappers." **The prize is being listed on the Cursor / Claude Code / Zed pages, not your own.** |
| **[SaaSHub](https://www.saashub.com/services/submit)**          | ✅ medium           | Free. _"The submission will be slowed down and put to the bottom of the queue if there are not listed competitors"_ → **list Cursor / Zed / Continue / Aider / OpenHands.**                                                                 |
| **[LibHunt](https://www.libhunt.com/repo/submit)**              | ✅ 60 sec           | Single URL field. Bonus: it monitors _"everything that's posted on Reddit, HackerNews & Dev.to (almost in real-time)"_ — every later post feeds it automatically.                                                                           |
| **[OpenAlternative](https://openalternative.co)**               | 🟡 free only        | Star minimum is **unconfirmed** — About treats stars as a ranking input, not a gate. Paid packages $97–$197/mo: **do not pay**; ~661 monthly visits.                                                                                        |
| **StackShare / Slant / Openbase**                               | ❌                  | Openbase is dead (domain does not resolve). StackShare is a zombie post-FOSSA acquisition. Slant's team pivoted to Vetted.ai.                                                                                                               |
| **[GitHub Trending](https://github.com/trending)** / Trendshift | — nothing to submit | The upstream input to nearly every "AI repo of the week" video and newsletter. Won, not submitted. Trendshift ranks sustained momentum, so a slow burn can chart after falling off Trending.                                                |

---

## 7. Newsletters, YouTube, podcasts

| Target                                                | Route                                                                                                  | Notes                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Changelog News**                                    | [changelog.com/news/submit](https://changelog.com/news/submit)                                         | Verbatim: _"Submitting other people's work is encouraged, as well as **submitting your own work**."_ **The most self-submission-friendly outlet in this report.**                                                                                                     |
| **Console.dev**                                       | `hello@console.dev` (no form)                                                                          | 30,000+ devs. Their [criteria](https://console.dev/selection-criteria) are Otto's spec: self-service, no sales call, multi-platform, docs, power-user features. [Betas section](https://console.dev/betas/) takes pre-1.0. _"Console does not do sponsored reviews."_ |
| **TLDR** (7.2M)                                       | `submissions@tldr.tech`                                                                                | Target TLDR AI and TLDR Web Dev.                                                                                                                                                                                                                                      |
| **Hacker Newsletter** (60K)                           | none — hand-curated from HN                                                                            | Won by ranking on HN. Reinforces HN as the upstream lever.                                                                                                                                                                                                            |
| **Pragmatic Engineer** (1M+)                          | `pulse@pragmaticengineer.com`                                                                          | Covers trends, not launches. Pitch the trend, Otto as the example.                                                                                                                                                                                                    |
| **Latent Space** (200K)                               | [about page](https://www.latent.space/about): _"we do not accept cold emails."_ Guest-post form exists | Warm intro required. Highest value, slowest path. Their Discord is the on-ramp — which is why a bad drop there is expensive.                                                                                                                                          |
| **Ben's Bites**                                       | community submissions at [news.bensbites.com](https://news.bensbites.com/)                             | Verify the flow still exists                                                                                                                                                                                                                                          |
| **Import AI**                                         | —                                                                                                      | ❌ wrong format (research/policy)                                                                                                                                                                                                                                     |
| **IndyDevDan** (~136K)                                | business email in About                                                                                | **#1 YouTube target.** Entire channel is agentic coding — Claude Code stacks, MCP, subagents, agent teams. Otto is native content.                                                                                                                                    |
| **Matt Williams** (@technovangelist)                  | business email                                                                                         | Founding **Ollama** maintainer — highest-credibility endorsement available for the local-model half of the pitch.                                                                                                                                                     |
| **GosuCoder**                                         | business email                                                                                         | Does head-to-head agent benchmarking. Exactly who reviews a new coding agent — and the natural home for the Phase 4 benchmark.                                                                                                                                        |
| **Cole Medin**, **AICodeKing**, **Digital Spaceport** | business email                                                                                         | Local-AI stacks / daily new-tool coverage / homelab                                                                                                                                                                                                                   |
| **Fireship** (4.2M)                                   | doesn't take pitches                                                                                   | Winning the HN front page is the actual path.                                                                                                                                                                                                                         |
| **The Changelog / Practical AI**                      | [changelog.com/request](https://changelog.com/request)                                                 | Best-fit network by a mile. **Get on Changelog News first, then request an episode.**                                                                                                                                                                                 |
| **Syntax**                                            | [syntax.fm/potluck](https://syntax.fm/potluck)                                                         | Cheapest legitimate shot on the board — a well-framed question gets Otto named on a large show.                                                                                                                                                                       |

**Pitch shape:** one paragraph, a 30-second clip, repo link, hook pre-written. Never a feature list.
Never offer money — their value is that they aren't sponsored.

---

## 8. Discord / forums

**No Discord's rules could be read — they are auth-gated.** Member counts are third-party scrapes,
±20%. Anyone claiming to have read a Discord's promo policy from the web is guessing.

**Otto's posture: Discord is write-only, in servers we've earned standing in. No listening anywhere.**
Automated user accounts are a ban-on-detection offense, and the Developer Policy prohibits using
message content to train or feed models without permission.

| Server                   | Members 🟡 | Note                                                                                                                                                                                                                                                 |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenCode** (Anomaly)   | ~66K       | [SST wrote publicly](https://sst.dev/blog/moving-to-discord/) about choosing Discord to support OSS communities — culturally the most OSS-friendly                                                                                                   |
| **Zoo Code**             | new        | [discord.gg/VxfP4Vx3gX](https://discord.gg/VxfP4Vx3gX) via [zoocode.dev](https://www.zoocode.dev/). Roo Code archived 2026-05-15 at 24,362★; this fork has 1,367★ and a "help us keep this alive" posture. **Most under-served target on the list.** |
| **LM Studio**            | ~80.5K     | Direct fit                                                                                                                                                                                                                                           |
| **Ollama**               | ~197K      | Direct fit                                                                                                                                                                                                                                           |
| **Claude (Anthropic)**   | ~115K      | Their [community page](https://claude.com/community) describes it as "Real-time help, **project sharing**, and active discussions"                                                                                                                   |
| **OpenRouter**           | ~49.8K     | Forum-type `#help` channel — much safer than general chat                                                                                                                                                                                            |
| **Aider**                | ~10.4K     | Terminal-agent culture, closest philosophically                                                                                                                                                                                                      |
| **Cline**, **Kilo Code** | 23K / 15K  | Verify Kilo's invite — an open issue reports it invalid                                                                                                                                                                                              |
| **Latent Space**         | ~10.6K     | Smallest, highest-signal room in the space. These people write the newsletters and run the podcasts. **Go last.**                                                                                                                                    |
| **Zed**                  | ~28K       | **Highest reputational risk** — Otto is a rival editor. Skip.                                                                                                                                                                                        |

**There is no official r/LocalLLaMA Discord.** Servers claiming the name are third-party.

**Zero-etiquette-risk front doors — do these instead of cold Discord drops:**

- **Anthropic project submission:** [form.typeform.com/to/VIUAjxNi](https://form.typeform.com/to/VIUAjxNi) — official, "for potential feature on Claude's social channels."
- **OpenAI [Codex for Open Source](https://developers.openai.com/community/codex-for-oss)** and [Codex Ambassadors](https://developers.openai.com/community/codex-ambassadors).

**Forums beat Discord for a solo maker** — indexed, permanent, searchable:
[community.openai.com](https://community.openai.com/) (Codex category) ·
[GitHub Copilot Conversations](https://github.com/orgs/community/discussions/categories/copilot-conversations) ·
[discuss.huggingface.co](https://discuss.huggingface.co/) · [forum.cursor.com](https://forum.cursor.com)

**Cadence:** join five, lurk a week, read `#rules`, post in at most two. ≤2 servers/week. Always a
designated channel, always a clip + repo link + one genuine technical detail, stay 48h, never reuse
wording. Realistic failure mode is not a ban — it's silent deletion, a mod DM, and the durable label
"the guy who spams his IDE" in a small set of overlapping communities.

---

## 9. Competitive context (kept current, feeds positioning)

| Project                 | Stars (2026-07-19) | State                                                                 |
| ----------------------- | ------------------ | --------------------------------------------------------------------- |
| openclaw/openclaw       | **383,485**        | The 2026 story; created 2025-11-24                                    |
| anomalyco/opencode      | **187,496**        | Category leader; MIT                                                  |
| anthropics/claude-code  | 138,330            | Shipped mobile Remote Control 2026-02-24                              |
| zed-industries/zed      | 87,245             | Rival editor — do not post in their spaces                            |
| cline/cline             | 64,814             | Shipped mobile + Kanban orchestration in 2026                         |
| Aider-AI/aider          | 47,514             | **Stalling** — last push 2026-05-22; leaderboard stale since Nov 2025 |
| continuedev/continue    | 34,970             | **Frozen** — "no longer actively maintained… read-only"               |
| voideditor/void         | 28,856             | **Archived** 2026-06-02                                               |
| RooCodeInc/Roo-Code     | 24,362             | **Archived** 2026-05-15 → diaspora at Zoo Code                        |
| **getpaseo/paseo**      | **10,864**         | Upstream. Active. A realistic ceiling for this niche.                 |
| **Draek2077/otto-code** | **1**              | Public 14 days                                                        |

**The 2026 shift that matters most:** Anthropic's January–February enforcement against third-party
OAuth reuse. OpenCode's PR literally titled ["anthropic legal requests"](https://github.com/anomalyco/opencode/pull/18186)
(544 downvote reactions) preceded a 1,274-point HN thread and a vertical star climb. Provider-neutrality
became a hedge rather than a feature. **That is Otto's exact thesis — the market moved toward us.**
Have the essay written before the next incident, not after.
