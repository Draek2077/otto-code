---
title: Orchestration skills
description: "Otto orchestration skills: teach coding agents to spawn, coordinate, and manage other agents using slash commands."
nav: Skills
order: 33
category: Orchestration
---

# Orchestration skills

Otto ships orchestration skills that teach coding agents (Claude Code, Codex) how to use the Otto CLI to spawn, coordinate, and manage other agents. Skills are slash commands your agent can invoke, they provide the prompts, context, and workflows so agents know how to orchestrate without you writing boilerplate. Install them from host Settings or with the command below.

## Installation

- **Otto app:** Connect to the host, then open Settings → Host → Agents → Orchestration skills. The selected host installs the skills on its own machine.
- **Manual:** `npx skills add Draek2077/otto-code`, this installs to `~/.agents/skills/` and sets up symlinks for each agent.

When a daemon finds installed Otto skills, it keeps the selected bundled skills up to date on startup without removing deselected directories. Use the host's Orchestration skills card to install, update, choose, or uninstall skills. Removal always asks for confirmation.

## Project knowledge skills

- `/otto-setup-project-knowledge` initializes and verifies the empty `.otto` Markdown store.
- `/otto-onboard-project` researches code, documentation, tests, and Git history, fills the six
  rich Markdown project-map roots, then records human-linked proposals for decisions, constraints,
  requirements, and architecture.
- `/otto-project-knowledge` provides the operating workflow for querying, updating, reviewing, and
  safely maintaining existing pages.
- `/otto-ingest-project-knowledge` captures a conversation, document, test, or research result as
  reviewable proposals.

Every chat receives a compact Knowledge catalog. Full page content is read only when it is
relevant. Proposals remain review-only until a user confirms them in Manage knowledge.

```
/otto-onboard-project onboard this repository's project knowledge
```

## `/otto`, Otto Reference

The foundational skill. Otto reference for managing projects, workspaces, and agents. Load it when an agent needs to register a project, create agents, send them prompts, or manage workspace isolation.

Not typically invoked directly by users, it's a reference that other skills depend on.

```
/otto show me the Otto CLI surface for creating an agent in a worktree
```

## `/otto-handoff`, Task Handoff

Transfer the current task with a briefing: relevant files, progress, decisions, constraints, and acceptance criteria. The skill checks profiles before choosing the receiving agent; you can name the profile you want.

```
/otto-handoff hand off the auth fix to codex in a worktree
/otto-handoff hand this to claude opus for review
```

The receiving agent gets the context it needs to continue. Ask for a separate worktree when it should edit independently.

## `/otto-committee`, Committee Planning

Get two agents to analyze a difficult problem independently. The skill checks profile notes for planning and analysis, preferring different provider families when possible.

```
/otto-committee why are the websocket connections dropping under load?
/otto-committee plan the auth system migration
```

Committee members return analyses without editing files. The main agent synthesizes their plans, implements the solution, and sends the diff back for review.

## `/otto-advisor`, Advisor

Get another agent's judgment on a design, diff, or question. The skill chooses a profile whose notes fit the work, or uses the profile you name.

```
/otto-advisor did I miss anything in this migration plan?
/otto-advisor --profile "UI Work" what is the UX risk in this flow?
```

The advisor returns a second opinion without editing files.
