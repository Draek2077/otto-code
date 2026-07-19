# Runbook

Operational playbook. Read [outreach.md](outreach.md) for why; this is what to do.

---

## 1. Approved phrasing — use verbatim

### How Otto talks to Claude

> Otto drives the official Claude Code Agent SDK using your own credentials on your own machine. It
> does not proxy, reuse, or spoof OAuth tokens from Claude Free, Pro, or Max accounts.

**Why this matters:** Anthropic clarified in February 2026 that using Claude subscription OAuth
tokens in third-party products is not permitted, and enforced it against OpenCode — whose removal PR
was literally titled ["anthropic legal requests"](https://github.com/anomalyco/opencode/pull/18186)
and drew 544 downvote reactions and a 1,274-point HN thread. This audience watched it happen and will
check. Sloppy wording here turns a good thread into a hostile one.

### The fork

> Otto is a fork of [Paseo](https://github.com/getpaseo/paseo) — everything Paseo does, plus a mission
> on top: bring frontier-model tooling to every provider equally, cloud and local alike.

Say it first, unprompted, every time. Never a comparison that disparages upstream.

### The gaps

> No macOS or iOS builds yet — I don't have access to a Mac development environment. Windows, Linux,
> Android APK, and the web app all ship today. If you can help with the Mac side, get in touch.

### Disclosure, where a channel requires it

- **Reddit** (policy updated 2026-05-19, AI content must not "present itself as human-generated"):
  tag AI-assisted content.
- **DEV** (Code of Conduct): disclose AI assistance.
- **Any post mentioning Otto anywhere:** "disclosure: I built this."
- **Hacker News and Lobsters:** no AI text at all, so nothing to disclose — just don't.

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
- **Never solicit** upvotes, comments, stars, or shares — including in the Discord, including from
  friends. HN's voting-ring detector fires automatically and the penalty ladder is
  submission → account → **domain**.
- **Spread sends.** Never fire an approved batch at once. Reddit's human-verification keys explicitly
  on how quickly an account attempts to write.
- **Never delete and repost** on HN — it forfeits the [second-chance pool](https://news.ycombinator.com/pool).
  Reposting later, without deleting, is fine and often works (Void: 13 points → 347 points, five days
  apart, same author).
- **Give before you take.** File the upstream bug, answer the unrelated question, review the PR. The
  ledger is not paperwork; it is the thing that makes the eventual post land.

---

## 4. Post-send verification — do this every time

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
| **HN domain ban suspected**       | Email `hn@ycombinator.com`. Plain, honest, no arguing. dang lifts domain bans routinely — tylervigen.com was banned purely for over-submission and later unbanned. **The ban is recoverable; not knowing about it is not.** |
| **HN post killed / flagged**      | Do not delete. Do not repost immediately. Email hn@ if it looks like a mistake; otherwise let it go and try again later with better framing.                                                                                |
| **Reddit shadowban**              | Stop all Reddit activity. Check r/ShadowBan. Appeal via support. Do not create another account — ban evasion escalates it to sitewide.                                                                                      |
| **Subreddit removal / mod DM**    | Apologize once, briefly, ask what the right channel is, comply. Do not argue. Mods talk to each other.                                                                                                                      |
| **Accused of astroturfing**       | Respond once, plainly, with the facts: one account, no vote solicitation, disclosure in every post. Do not litigate. Then leave the thread.                                                                                 |
| **Someone notices the fork late** | This should be impossible if §1 is followed. If it happens: acknowledge immediately, link Paseo, state what Otto adds. Never defensive.                                                                                     |
| **A provider changes its rules**  | The essay is already written ([content.md](content.md) §3, piece 3). Publish it, don't celebrate, and be accurate about what actually changed.                                                                              |
| **A post goes unexpectedly well** | Stay in the thread. Answer everything. Do not cross-post the success elsewhere. Do not launch anything else that week.                                                                                                      |

---

## 6. Weekly loop

Fifteen minutes, once a week:

1. Review the queue — approve, edit, or reject. Rejecting is normal.
2. Read what the watchtower surfaced. Most items are `give` opportunities, not `take` ones.
3. Check the signal CSV: stars, unique views, top referrer, download delta.
4. Check tripwires — has anything unblocked?
5. Confirm the dossier has no channel gone stale past 90 days.

## 7. Quarterly

- Re-verify every channel's rules from primary sources. This space changed four times in H1 2026.
- Re-check the competitive table in [channels.md](channels.md) §9 — projects archive fast.
- Re-read the positioning in [outreach.md](outreach.md) §3 against what shipped. It has already been
  overtaken once (mobile, February 2026); assume it will happen again.

---

## 8. The one-line test

Before anything goes out, ask: **would I be comfortable if this exact post, and my entire posting
history, were quoted in a thread accusing me of astroturfing?**

If yes, send it. If not, the problem is not the wording.
