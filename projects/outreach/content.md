# Content — assets, copy shapes, calendar

What gets made, in what order, and what each channel expects. Positioning and the message house live
in [outreach.md](outreach.md) §3; this file is the production plan.

---

## 1. The asset library

Everything below is produced by the existing `site-demos` pipeline (`packages/app/demo/`, Playwright,
2560×1440, both Twilight and Daylight themes, MP4/WebM + PNG + `manifest.json`, no GIF). The pipeline
exists and works; **the website consumes none of its output yet** — that gap is Phase 0.3.

| #   | Asset                     | Spec                                                                                                                                          | Used by                                                  |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A1  | **The parity clip**       | 40s. Same task, same repo, same browser-verified preview — Claude first, then a local LM Studio model. Payoff visible in the first 2 seconds. | Everything. Landing page, every post, every pitch        |
| A2  | Multi-provider split pane | 20s. Two providers, one workspace, side by side.                                                                                              | r/LocalLLaMA, LM Studio, Ollama                          |
| A3  | Preview verification      | 25s. Agent starts the dev server, changes code, screenshots the result, shows proof.                                                          | HN brief, DEV article, Console.dev                       |
| A4  | Personalities & teams     | 20s. Named agents with roles and colors; one spawning another.                                                                                | r/ClaudeCode, Anthropic form                             |
| A5  | Phone continuation        | 15s. Desk → phone, same session. **Supporting, never the lead** (see [outreach.md](outreach.md) §2a).                                         | Store listings, mobile-adjacent subs                     |
| A6  | Subagent accounting       | 20s. Real per-subagent token/cost rows.                                                                                                       | The benchmark post, r/mcp                                |
| A7  | Stills                    | Hero, split panes, personalities, changes view — both themes                                                                                  | Directories, press kit, store cards                      |
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
| **r/selfhosted**       | Screen-recorded clip → what it is → Compose snippet → GitHub link → "I built this"                       | A9, docs, production-ready claim                            | Standalone posts blocked until 2026-10-05 — megathread only |
| **r/LocalLLaMA**       | Comparison framing: "same harness against LM Studio vs Claude — here's what breaks"                      | Disclose affiliation                                        | Reads as a product ad rather than a finding                 |
| **r/ClaudeCode**       | Showcase with A1 + A4                                                                                    | **Flair: `Showcase` or `Resource`**                         | Posting without flair = auto-removal                        |
| **r/programming**      | **Technical writeup only** — never a project post                                                        | Substance about a hard problem                              | "Just a link to a github page or a list of features"        |
| **DEV**                | **Full article body on DEV** (linking out violates their terms)                                          | `canonical_url` home, ≤4 tags, **AI-assistance disclosure** | Teaser-plus-link                                            |
| **Mastodon/Fosstodon** | Real post with context, ≤3 hashtags                                                                      | Never a bare link                                           | Link-only posts and hashtag stuffing trip their ad rule     |
| **Bluesky**            | Native video first, link in a reply                                                                      | Own content only                                            | Any automated reply causes a notification → prohibited      |
| **Directories**        | Objective one-liner, no emoji, no second person, no "open-source/free/self-hosted" filler                | `(fork of Paseo)` where the list has a fork convention      | Sales-pitch phrasing gets rejected on sight                 |
| **Newsletter pitch**   | One paragraph + A1 + repo link + pre-written hook                                                        | The hook, not a feature list                                | Sending a feature list                                      |
| **YouTube pitch**      | Subject = the claim. Three sentences. Never offer money.                                                 | A1                                                          | Anything that reads as a sponsorship approach               |

### The hook, pre-written

> A solo maker gave a local LM Studio model the same harness Anthropic gives Claude — browser-verified
> previews, subagent visibility, MCP, compaction. Here's what broke and what didn't.

Benchmarkable, filmable, and true. Use it in every pitch.

---

## 3. The three Phase 0 blog posts

The blog system works (`packages/website/posts/`, drafts hidden unless `?drafts`) and has **zero
published posts**. Every Phase 1 submission points at a site whose blog is empty. These three fix
that, and each does double duty as a channel asset.

1. **"Giving a local model the frontier harness"** — the parity thesis, with A1 embedded and the
   engineering detail underneath: how preview verification, subagent observation, and compaction were
   made provider-neutral. This is the Console.dev and Show HN backbone.
2. **"What happens when your provider changes the rules"** — the independence argument.
   Deliberately written _before_ it is needed: OpenCode gained ~18,000 stars in two weeks when
   Anthropic blocked it, and the next such incident will happen. Must state precisely how Otto talks
   to Claude (see [runbook.md](runbook.md) §1).
3. **"Proof, not 'should work now'"** — the preview subsystem as a design argument about agents that
   verify their own work. The most technically interesting thing in the repo, and the one most likely
   to survive a Lobsters or r/programming audience.

Publish on otto-code.me, cross-post full text to DEV with `canonical_url` home, submit each to
Changelog News.

---

## 4. Editorial calendar

Cadence: **one substantial piece every 2–3 weeks.** The Cline lesson is that the argument is the
marketing and the product is the proof — and that is a strategy a solo maker can actually sustain,
because it is writing rather than spend. It is also the entire supply line for Changelog News,
Console.dev, Pointer.io, Pragmatic Engineer, and r/programming.

| Slot | Piece                                                 | Feeds                                            |
| ---- | ----------------------------------------------------- | ------------------------------------------------ |
| 1    | Giving a local model the frontier harness             | Phase 0 gate, Console.dev, Changelog News        |
| 2    | Proof, not "should work now"                          | Phase 0 gate, DEV `#showdev`                     |
| 3    | What happens when your provider changes the rules     | Phase 0 gate; held ready for the next incident   |
| 4    | Six providers, one agent loop — what actually differs | r/programming (technical-writeup rule), Lobsters |
| 5    | **Benchmark v1** (Phase 4)                            | The citable artifact; GosuCoder; HN              |
| 6    | Otto runs its own outreach                            | The dogfooding story; DEV; the pipeline as proof |
| 7    | Show HN companion writeup                             | Phase 6                                          |

**Rule: never publish on a schedule you cannot hold.** Directories drop inactive projects
(awesome-selfhosted at 6–12 months, daily.dev at 3), and the Aider/Void failure mode is maintainer
attrition, not bad marketing. If a choice arises between shipping code and shipping a post, ship the
code — visible shipping is itself a distribution channel.

---

## 5. Things to say every time

- **"Otto is a fork of [Paseo](https://github.com/getpaseo/paseo)"** — first, unprompted, every time.
- **The honest gaps** — no macOS build (no Apple hardware), no iOS, Play internal-track only.
  Volunteering these defuses them; being caught omitting them costs the thread.
- **How Otto talks to Claude** — the approved phrasing in [runbook.md](runbook.md) §1, verbatim.
- **"I built this"** — the maker voice is the whole strategy. Never the passive corporate register.
