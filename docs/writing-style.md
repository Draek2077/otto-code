# Writing style: the house rules for prose

Applies to **everything a reader outside this repo sees**: the marketing site
(`packages/website`), the user manual (`public-docs/`), release notes, store listings, and the
marketing source material in `projects/marketing-strategy/` and `projects/outreach/`.

It does **not** govern code, or the internal engineering trees (`docs/`, Otto Knowledge, the rest of
`projects/`). Those are written for people who work on Otto, and consistency there matters less than
precision.

For terminology (which word to use for a thing) see [glossary.md](glossary.md). The UI label wins,
and there are no synonyms. This page is about how sentences are built, not which nouns go in them.

---

## No em-dashes

**Never use `—` (em-dash) or `–` (en-dash) in prose.** Not in site copy, not in the manual, not in
release notes, not in marketing drafts.

The reason is frequency, not grammar. The mark exists in English, but published human prose uses it
**sparingly**: a handful of times in a whole book, reserved for a genuine dramatic break. Language
models use it several times per paragraph, as a default connector standing in for a comma, a colon,
a semicolon and a full stop all at once. That gap between natural rate and machine rate is now wide
enough that readers worldwide treat the mark itself as a signature of generated text.

Most of Otto's prose is drafted by agents. So a reader who spots the pattern stops reading the
argument and starts counting the tells. The rule is absolute rather than "use sparingly" because
sparingly is exactly the judgement an agent gets wrong, every time, in the direction of more.

### What to use instead

An em-dash is almost always doing one of five jobs. Pick the one it was doing:

| The dash was doing…                | Use                           | Example                                                        |
| ---------------------------------- | ----------------------------- | -------------------------------------------------------------- |
| Introducing an explanation or list | A colon                       | `Three panes: chat, browser, diff.`                            |
| Joining two independent clauses    | A semicolon, or two sentences | `The daemon owns the loop; the client just renders it.`        |
| Marking a soft aside               | Commas                        | `The relay, which is optional, is end-to-end encrypted.`       |
| Marking a hard aside               | Parentheses                   | `Every provider (including local models) gets the same tools.` |
| Trailing an afterthought           | A full stop, then a sentence  | `You get proof. Not "should work now, can you check?"`         |

If none of those reads well, the sentence was carrying too much. Split it.

### What is still fine

- **Hyphens in compound modifiers**: `provider-neutral`, `end-to-end encrypted`, `16:9`.
- **Ranges written with words**: `8 to 15 commits`, not `8–15 commits`.
- **Minus signs and arithmetic** in code or code-adjacent text.
- **Anything inside a code block, identifier, file path, or quoted CLI output.** Do not rewrite a
  quoted string to satisfy a prose rule.

### Checking

```bash
rg -n "—|–" packages/website/src public-docs projects/marketing-strategy projects/outreach
```

Should return nothing outside code blocks and quoted output.

---

## Voice

- **First person singular, always.** Otto is a personal project by Philippe. It is "I built", never
  "we built" and never "the team". There is no team.
- **Say the thing, then stop.** No throat-clearing, no "in today's fast-moving landscape".
- **Claims are traceable.** A capability named on the site exists in
  [feature-inventory.md](../projects/marketing-strategy/feature-inventory.md), which was verified
  against the fork point. Marketing copy does not get to invent features, and it does not get to
  describe a simulated screenshot as a real one.
- **Credit is loud and specific.** Otto and Agent Flow are named, linked, and thanked wherever
  their work is being shown.
