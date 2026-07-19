# The pipeline — AI automation architecture

What the machine does, what it must never do, and how it is built.

The design premise, from [outreach.md](outreach.md) §4: **the queue is not a send button. It is a rate
governor and a give:take ledger.** 2026 enforcement on every platform fires on velocity and pattern,
not on whether a human clicked. A system that lets you approve twenty items and fire them in ten
minutes is more dangerous than no automation at all.

---

## 1. Package layout

`packages/outreach/` — a new workspace package, **fully separate**, per [outreach.md](outreach.md) §5.

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

## 2. Listening — only what is free and in-ToS

| Source               | Method                                                                                                                         | Status                                                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hacker News**      | [Algolia](https://hn.algolia.com/api) `search_by_date` + `numericFilters=created_at_i>{last}`, plus Firebase `/updates`        | ✅ no key, no auth, ~10K req/hr; Firebase states "no rate limit"                                                                                                                                                                                                                                        |
| **GitHub**           | `/search/issues?q=<kw>+in:body`, `/notifications`, repo Events, `releases.atom`                                                | ✅ explicitly not scraping per their AUP; 5,000 req/hr authenticated                                                                                                                                                                                                                                    |
| **RSS**              | YouTube channels (`feeds/videos.xml?channel_id=`), Lobsters tags, GitHub releases/commits, Mastodon profiles, competitor blogs | ✅ unambiguously fine, no keys                                                                                                                                                                                                                                                                          |
| **Bluesky**          | [Jetstream](https://docs.bsky.app/blog/jetstream) filtered to `app.bsky.feed.post`, keyword match locally                      | ✅ free, self-hostable, no app review                                                                                                                                                                                                                                                                   |
| **Reddit**           | **[F5Bot](https://f5bot.com) → email → parsed inbox**                                                                          | ⚠️ **do not build against the Reddit API.** Self-service OAuth registration closed Nov 2025; unauthenticated `.json` returns 403 since May 2026; RSS throttled to ~1/min June 2026. Buy (or free-tier) the listening rather than fight the approval process. Alternative: [Syften](https://syften.com). |
| **Discord**          | **none**                                                                                                                       | 🔴 not built. Listening in servers we don't own is ToS-prohibited in substance; automated user accounts are ban-on-detection.                                                                                                                                                                           |
| **X**                | **none**                                                                                                                       | 🔴 $0.005/read with no free tier. Not worth it.                                                                                                                                                                                                                                                         |
| **YouTube Data API** | **none** — use channel RSS instead                                                                                             | ⚠️ `search.list` was cut to **100 calls/day** on 2026-06-01                                                                                                                                                                                                                                             |

**Design note:** every listener writes normalized `Signal` records to one store. Keyword sets live in
`channels.yml`, not in code — competitors, category terms, and Otto's own names, tracked separately so
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

## 4. Drafting — and the line it must not cross

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
the links. dang's stated advice — _"a detailed technical writeup… the more detail, the better"_ — is
something only the person who built it can write.

**Never drafted at all:** replies in live threads, DMs, anything addressed to a named individual.

---

## 5. The governor — the part that actually matters

Runs between drafter and queue. A draft that fails any check does not reach the human.

**Cadence caps** (per `channels.yml`): default ≤1 Reddit submission/week, ≥30 days between posts in
the same sub, ≤2 Discord servers/week, ≤1 HN submission per milestone.

**Give:take ledger.** Every outbound item is classified `give` (a substantive contribution that does
not mention Otto — answering someone's question, filing a bug upstream, reviewing a PR, writing
something useful) or `take` (mentions Otto). **The governor refuses to release a `take` for a channel
whose running ratio is under 9:1.** Reddit's Reddiquette names 9:1 explicitly; Lobsters says
self-promo should be "less than a quarter"; HN says "the primary use of the site should be for
curiosity." Encoding it in software is the difference between a rule you remember and a rule that
holds.

**Send jitter.** Approved items are released on a randomized schedule, never in a batch. Reddit's
human-verification explicitly keys on _"how quickly the account is attempting to write or post
content."_ The governor enforces a minimum inter-send gap globally, not just per channel.

**Duplicate-text detection.** Refuses near-identical bodies across channels — the classic
cross-posting trigger, and the thing moderators pattern-match fastest.

**Tripwires.** Watches the star/date gates from [channels.md](channels.md) §0 and surfaces a channel
the day it unblocks (awesome-selfhosted on 2026-11-05, r/selfhosted on 2026-10-05, Homebrew at 225★,
Coolify at 1,000★).

**Kill switch.** One flag halts all outbound. Used the moment anything in §7 fires.

---

## 6. Where it runs — recommendation

**Otto runs its own outreach.** A `Herald` agent personality on a scheduled agent, using the CLI above
as its toolbelt, producing the review queue as an artifact. Otto already has scheduled agents, MCP,
personalities, and artifacts — this is mostly wiring, and it dogfoods four subsystems at once. It is
also, itself, a story worth telling in Phase 5.

**With a dead-man's switch:** a GitHub Action on `schedule:` that runs `snapshot` daily regardless.
The measurement data is the one thing that cannot be reconstructed later — GitHub discards traffic
data after 14 days. Two known Action gotchas: `schedule:` triggers skew 10–60+ minutes under load, and
scheduled workflows in public repos **auto-disable after 60 days of repository inactivity** (the daily
data commit prevents this by construction).

Secrets: local `.env` for the maker's machine; GitHub environment secrets with required reviewers if
the Action ever writes anywhere. Never in the repo.

---

## 7. Post-send verification — the highest-value telemetry in the system

Both HN and Reddit punish silently. You can post for weeks into a void with no notification.

15 minutes after every send, automatically:

1. **Logged-out fetch** of the submission URL. Missing → shadowban or removal.
2. **HN:** check whether the item is `[dead]` (visible only with `showdead`), and whether it appears
   on `/newest` logged out.
3. **Reddit:** check the post renders logged-out; periodically self-check via r/ShadowBan.
4. **Domain check:** submit nothing, but watch for the pattern where _every_ recent submission of
   otto-code.me is invisible — that is a domain ban, not bad luck.

On failure: fire the kill switch, notify, and **stop posting until diagnosed.** Recovery for HN is
`hn@ycombinator.com`, and dang lifts domain bans routinely — but only if you know to ask.

---

## 8. Measurement

Daily snapshot, appended to CSV, committed:

| Metric                             | Endpoint                                                   | Note                                               |
| ---------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| Unique views + top referrers       | `/repos/{o}/{r}/traffic/views`, `/popular/referrers`       | **14-day retention — snapshot or lose it forever** |
| Stars with timestamps              | `/stargazers` + `Accept: application/vnd.github.star+json` | Cleanest awareness proxy                           |
| Release asset downloads            | `releases[].assets[].download_count`, daily delta          | Cumulative; excludes source tarballs and clones    |
| Clicks per channel                 | own `/go?c=` redirector logs                               | The only real attribution                          |
| npm, Docker pulls, Discord members | registry APIs                                              | Trend only — CI-inflated                           |

**Why the redirector is not optional:** GitHub's traffic API reports **hostnames only** — no paths, no
query strings. `github.com/Draek2077/otto-code?utm_source=reddit` returns nothing useful. Routing
through `otto-code.me/go?c=reddit-selfhosted` → 302 puts the attribution in a log line we own and
collects nothing about the visitor. Browsers now default to `strict-origin-when-cross-origin`, so
expect origin-level referrers (`https://news.ycombinator.com/`) and no thread paths.

**Nothing here touches a user.** No app telemetry, no daemon telemetry — that does not change.

---

## 9. Build order

1. `signal/` + the `/go` redirector + the daily Action — **first**, because the data is perishable and every later phase is measured against a baseline that must exist beforehand.
2. `dossier/` + `channels.yml` — encodes Phase 0.9's hand-verification.
3. `watch/hn` + `watch/github` + `watch/rss` — free, in-ToS, useful immediately.
4. `governor/` + `queue/` — before the drafter, so nothing can bypass it.
5. `draft/` — last. It is the least important component; the governor and the dossier are what make the system safe, and the human is what makes it good.
6. `watch/bluesky`, F5Bot inbox parsing — once the loop is proven.

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
