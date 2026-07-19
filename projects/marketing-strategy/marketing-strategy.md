# Otto marketing strategy

Charter. Nothing here is built yet.

## Why this exists

Otto inherited Paseo's public voice along with its code. The README, the landing page, the
sponsor page, and the blog byline all spoke as Mo — his X handle, his Discord, his avatar,
his first-person "I'm a solo maintainer, ping me on Discord". That is a fork of someone
else's web identity, not a fork of their software, and it has been removed (see "Voice
cleanup" below).

Removing it left a real gap: **Otto currently has no public presence of its own.** Every
"reach us" path in the product and on the site now points at GitHub Issues. That's honest
and correct as a floor, but it's the only channel, and GitHub Issues is a bad first
impression for anyone who hasn't already decided to try the thing.

## The voice we replaced it with

Otto's public voice is **Philippe, first person, singular**. Not "we", not a company.

The story, in one paragraph — this is the canonical version; keep the site, README, and any
future post consistent with it:

> Otto is a personal project by Philippe — not a startup, just the environment I want to
> work in and the way I'm getting better at agentic coding. Most of Otto is written by the
> agents Otto runs. The problem I keep hitting is that agents can now do an enormous amount
> of work on their own, and it's hard to see what they did, what it cost, and where it went
> sideways. So the work leans toward making that legible: real per-subagent token and cost
> accounting, a live visualizer of the orchestration graph, browser-verified previews so an
> agent proves a change instead of claiming it. The rest is pulling good open-source pieces
> into one setup that works end to end.

Tone rules:

- First person singular. Never "we" — there is no we.
- No startup posturing, no roadmap promises, no "trusted by" anything.
- Credit upstream loudly and specifically, and say _why_ the work is good rather than just
  naming it. Two projects carry Otto and both get named sections, not footnotes:
  - **Paseo (Mo Boudra, AGPL-3.0)** — the foundation. The compliment that is actually true:
    the hard parts were already right (process lifecycle, clean WebSocket protocol, real
    cross-platform clients, E2E relay), so Otto's work is features instead of plumbing.
  - **Agent Flow (Simon Patole, Apache-2.0)** — the Visualizer's render layer, vendored as a
    git subtree. The compliment that is actually true: Simon kept rendering separate from
    event collection behind a small documented bridge protocol, which is the only reason Otto
    could drive the same graph from its own provider-neutral stream and have it work for
    every provider. Adapting it has been the most enjoyable part of the project — say so.
  - Trademark guardrail: never use "Agent Flow" as a UI label or ship their logos. The
    feature is **"Visualizer"**, locked (`vendor/agent-flow/TRADEMARK.md`). Attribution prose
    is fine and required; branding is not.
- Otto takes no sponsorships of its own — support routes upstream to both.
- Lead with the observability thesis, not the feature list. The feature list is the proof,
  not the pitch.

## Voice cleanup (done)

| Where                                          | Was                                            | Now                                              |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `README.md` badges                             | X @moboudra, Paseo Discord, r/OttoAI           | GitHub stars / release / issues                  |
| `README.md` note                               | "I'm a solo maintainer… reach me on Discord"   | One-person project, GitHub Issues                |
| `README.md`                                    | —                                              | New "Why I'm building this" section              |
| `landing-page.tsx` BuiltOnPaseoSection         | "one developer wanting to shape Paseo…"        | `BuiltOnOpenSourceSection`; Philippe's story     |
| `landing-page.tsx` upstream pillars            | 2 cards (Paseo / Otto)                         | 3 cards — Paseo, Agent Flow, Otto mission        |
| `landing-page.tsx` FAQ + credit CTA            | "we / ours"                                    | "I / mine"; new "What powers the Visualizer?"    |
| `sponsor.tsx`                                  | "Support Mo, the author of Paseo"              | "Support the projects Otto is built on" (both)   |
| `README.md` credits                            | one Paseo paragraph                            | named section per project, each with the why     |
| `NOTICE`                                       | generic third-party clause                     | explicit Agent Flow Apache-2.0 + §4 state notice |
| `blog/$.tsx` byline                            | Mo Boudra + his avatar, linking x.com/moboudra | Philippe → github.com/Draek2077                  |
| `site-header.tsx`, `site-footer.tsx`           | Discord icon, Discord + Reddit links           | Removed; Issues link                             |
| `cloud.tsx` contact fallbacks                  | "DM me on Discord"                             | GitHub Issues                                    |
| `community-links.tsx` (app)                    | "Community" → Paseo Discord                    | "Feedback" → Otto Issues                         |
| `packages/website/public/9viSwGkz_400x400.jpg` | Mo's avatar                                    | Deleted                                          |

## Open work — channels Otto actually needs

None of these exist yet. Roughly in the order they'd pay off:

1. **GitHub Discussions** — turn it on for `Draek2077/otto-code`. Zero cost, right venue
   for "how do I…" that shouldn't be an issue, and it's already where the links point.
2. **A Discord of our own** — the one channel people genuinely expect from a self-hosted dev
   tool. Only worth creating once there's someone to talk to; an empty server reads worse
   than no server. Gate on: first handful of external users.
3. **An X / Bluesky / Mastodon account** — for release notes and short build-log posts. Pick
   one, not three. This is also the natural home for the "agents built this, here's what
   that looked like" content, which is the genuinely differentiated angle.
4. **The blog** — `packages/website/src/posts/` is wired up and completely empty. The blog
   route, byline, and index all work; there is simply nothing in it. Cheapest credible
   first move on this list.
5. **r/OttoAI or similar** — lowest priority. Subreddits need sustained volume; skip until
   there's a community that would fill one.

Every one of these needs a decision from Philippe (accounts, handles, moderation appetite)
before any code or copy lands. Nothing should be linked from the site or the app until the
destination actually exists — that's the mistake being corrected here.

## Content angles worth having

- **Build log, agent-authored.** Otto is written by the agents it runs. Post the real
  artifacts: the visualizer graph of a feature being built, the token/cost ledger for it,
  the preview verification that caught the bug. Nobody else can show this because nobody
  else instruments it.
- **"What did that actually cost?"** Per-subagent accounting is the least-solved problem in
  agentic coding and Otto has real numbers. One honest post with real figures beats ten
  feature announcements.
- **Provider parity.** "The same frontier tooling on a local LM Studio model as on Claude"
  is the fork's whole mission and is concretely demonstrable.

## Non-goals

- No paid acquisition, no launch-day theater, no "Product Hunt strategy".
- No claiming Paseo's community, sponsors, testimonials, or metrics as Otto's.
- No hosted/paid tier marketing until Otto Cloud is more than a signup form.
