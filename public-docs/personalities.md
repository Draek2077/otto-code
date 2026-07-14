---
title: Agent personalities
description: Named, reusable agent templates that bind a provider, model, effort, mode, prompt, roles, and identity — so you pick "who does the work" once.
nav: Overview
order: 28
category: Personalities
---

# Agent personalities

An **agent personality** is a named, reusable template for an agent. Instead of choosing a provider, model, effort level, and permission mode every time you start work, you set a personality up once and then just pick it. Selecting one fills in all of those fields for you — and you can still tweak any of them by hand afterward.

Personalities are the ergonomic way to pick **who does the work**. The raw provider and model lists are still there for full control; personalities sit on top as the friendly default.

The point is that this works the same on every provider. A personality bound to a local LM Studio model is just as much a "Chatter" or a "Judger" as one bound to a frontier API — the identity, the roles, and the tooling don't care where the model runs.

## What a personality carries

Each personality bundles a **brain** and an **identity**:

- a **provider → model** pair,
- an **effort** level (how hard the model reasons — resolved to whatever that specific model supports),
- a default **permission mode** (plan, default, full-access, …),
- a **personality prompt** — a system prompt that shapes how the agent behaves,
- one or more **roles** (see below),
- an **identity**: a name, two spinner colors, and an optional **voice** for spoken replies.

You manage personalities in **Host settings → Agents → Agent personalities**. Each row shows the name, its provider·model·roles, and a live preview of its spinner colors, with add / edit / delete and a "Used N times" counter.

## Roles

Roles decide **where a personality shows up**. A personality can have as many roles as you like (the editor has an All / None toggle, and a new personality starts with all of them).

| Role             | What it's for                                                                                      | Where it appears                      |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Chatter**      | Interactive chats with an agent                                                                    | The composer's model picker           |
| **Artificer**    | Creating and managing artifacts                                                                    | The artifact create sheet             |
| **Scheduler**    | Creating and managing [schedules](/docs/schedules)                                                 | The schedule form                     |
| **Writer**       | Fast, cheap small-text generation — commit messages, summaries, branch and workspace names         | Automatically, for those mini-tasks   |
| **Coder**        | Doing focused coding sub-tasks spawned by another agent                                            | Via skills and Otto tooling           |
| **Judger**       | Reviewing and judging work                                                                         | Via review / committee skills         |
| **Advisor**      | Giving a second opinion — read-only, never edits                                                   | Via the advisor / committee skills    |
| **Orchestrator** | Running multi-agent workflows — a semantic label; any agent can list and spawn other personalities | Via committee / handoff / loop skills |

Chatter, Artificer, and Scheduler surface directly in the app's pickers. Coder, Judger, Advisor, and Orchestrator are used by [orchestration skills](/docs/skills): a skill can say "spawn a Coder and a Judger" and Otto resolves those to your personalities, so a multi-agent workflow never has to hardcode a provider. **Writer** is used automatically: when Otto needs a commit message, a summary, or a branch name, it routes that mini-task to an available Writer personality before falling back to a built-in default — so those little bits of text are written by the fast, cheap model you picked. (Writer and Coder replaced the old single **Worker** role; a personality you tagged Worker before still works and now counts as a Coder.)

Roles also fall into two **tiers**. **Coordinators** — Chatter, Artificer, Scheduler, Advisor, Orchestrator — converse, plan, and delegate: they can see the whole roster and launch other agents. **Focused workers** — Writer, Coder, Judger — are spawned to finish one thing someone's waiting on and stay on that task. Every agent can still _see_ every personality; the tier just shapes whether an agent is expected to delegate or to keep its head down. When an agent lists the roster, each personality comes with a one-line "why you'd choose me" so agents can pick the right teammate on their own.

## The starter team

A fresh host comes with a **starter team** of six personalities so you're not staring at an empty editor. They're all set up on Claude models and cover every role between them:

| Name         | Roles                 | Model  | Effort · Mode         |
| ------------ | --------------------- | ------ | --------------------- |
| **Atlas**    | Orchestrator, Chatter | Opus   | high · auto           |
| **Sage**     | Advisor               | Opus   | xhigh · plan          |
| **Vera**     | Judger                | Sonnet | high · plan           |
| **Pixel**    | Artificer             | Sonnet | medium · accept edits |
| **Dash**     | Writer, Scheduler     | Haiku  | low · auto            |
| **Sprocket** | Chatter, Coder        | Sonnet | medium · default      |

The model choices follow cost and fit: Opus for low-volume, high-stakes reasoning; Sonnet for everyday building and review; Haiku for fast, cheap, recurring work.

You own this team — rename, retune, or delete any of them. If you clear the whole team it **stays** cleared across restarts. When some are missing, the editor shows a **Restore starter team** button that re-adds only the ones you don't have, so your customized or renamed personalities are never duplicated.

## When a personality is unavailable

A personality only works on a host where everything it needs resolves: the provider is connected and authenticated, the model exists, and the mode is valid there. If any of that is missing, the personality is **out of commission**:

- **In a picker** it's grayed out with the reason (for example "Blaze — LM Studio not connected") and can't be selected.
- **In automation** (a schedule, or an agent spawning it by name) it **fails loudly** with a named error rather than quietly falling back to some other model. If the starter team shows as out of commission, it usually means the host has no Claude provider connected yet.

The voice is the one soft part: if a personality's voice isn't available on the host, it just falls back to the default voice — it never blocks the personality.

## How selecting one behaves

Pick a personality at the top of a model picker and it fills in the provider, model, effort, and mode. From there:

- You can **hand-edit any field** and the agent keeps the personality's identity (its name, colors, and prompt) with your override layered on top.
- Only **clearing the personality** detaches it back to a plain provider/model choice.
- A running agent shows its personality's identity — the provider icon tinted with the personality's two colors, its name, and a spinner glow in those colors — instead of a raw provider/model/effort readout.
- Otto **remembers** your last-used personality per role, so the next create form reopens with it preselected (as long as it's still available).

Edits to a personality never disturb an agent that's already running — a live agent keeps the settings it was born with until it finishes. New runs pick up your changes; to bring edits into a running chat, re-select the personality from its model picker (see below).

### Switching personality on a running chat

You can hand a running chat to a different personality mid-conversation — or take its personality away — without losing the conversation:

- Open the running agent's **model picker** and drill into its provider: personalities of that provider family (with the Chatter role) appear above the model list, and the search box finds them by name.
- Picking one shows a **warning dialog** first — the switch applies that personality's prompt, model, mode, and effort, and takes effect from your next message. Tick "Don't show this again" to skip the dialog on this device from then on.
- While the switch applies, the model chip shows a brief spinner and sending is paused (you can keep typing); on Claude the new personality takes effect from your next message.
- Picking a **plain model** instead applies that model and asks you to confirm releasing the personality — confirming detaches it and removes its prompt.
- Clearing a personality keeps the model, effort, and mode as they are — only the prompt and identity go.

This needs an up-to-date host; older daemons simply don't offer the switcher.

## Spawning personalities from agents and skills

Personalities are first-class in Otto's agent-management tooling, so an orchestrating agent can build a team by role:

- `create_agent` accepts a `personality` (by name) and expands it to the right provider, model, effort, mode, and prompt.
- `list_personalities` enumerates the roster with roles and availability — available to any agent, so every personality can see the others and spawn them by name.
- Schedules can be bound to a personality and re-resolve it on every run, so edits land between runs.

The bundled [orchestration skills](/docs/skills) already use this: `/otto-committee` prefers contrasting Advisor and Judger personalities, `/otto-advisor` prefers an Advisor, `/otto-handoff` prefers a Coder, and `/otto-loop` maps its worker and verifier to Coder and Judger roles.

## Where next

- [Skills](/docs/skills), the orchestration skills that spawn personalities by role.
- [Providers](/docs/providers), the provider and model a personality binds to.
- [Schedules](/docs/schedules), which can run on a bound personality.
- [Voice](/docs/voice), the speech engines a personality's voice draws from.
