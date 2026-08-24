---
name: otto-committee
description: Form a committee of two high-reasoning agents to step back, do root cause analysis, and produce a plan. Use when stuck, looping, tunnel-visioning, or facing a hard planning problem.
user-invocable: true
---

# Committee Skill

Two agents from contrasting Personalities, fresh context, planning a solution in parallel.

**User's additional context:** $ARGUMENTS

## Prerequisites

Read the **otto** skill. Call `list_personalities` before choosing committee members, and read every entry's `roles` and `guidance`. Do not create committee agents until you have inspected the available personalities.

Contrast is the point of a committee, so prefer two suitable Personalities from different provider families. Pass each name as `create_chat`'s `personality`, as described by the **otto** skill. If fewer than two fit, use Otto's provider-discovery fallback for the missing member and tell the user.

## Composition

Two members with different reasoning styles:

- One Personality whose notes fit planning, research, or root-cause analysis.
- One contrasting high-reasoning Personality, from another provider family when possible.

If the user names Personalities, use those. Override the selection only when the user explicitly asks for different members.

## Hard rules

- **No edits.** Every prompt to a committee member ends with the no-edits suffix:

  ```
  This is analysis only. Do NOT edit, create, or delete any files. Do NOT write code.
  ```

- **Trust the wait.** Do not poll, send hurry-ups, or interrupt. GPT-5.4 can reason 15-30 minutes; Opus does extended thinking. Long waits mean it found something worth thinking about.
- **You are the middleman.** Drive plan -> implement -> review without yielding to the user, except for divergences that need their call.

## Phase 1: Plan

Write a problem-level prompt:

- High-level goal and acceptance criteria
- Constraints
- Symptoms, if a bug
- What you tried and why it failed
- Explicit: "do root cause analysis"
- Explicit: "state assumptions, ask why three levels deep, check whether you're patching a symptom or removing the problem"

Create both agents in parallel via Otto with `[Committee] <task>` titles and the same prompt. Wait for both, not just whichever finishes first.

Read both responses. Challenge them. Do not accept them at face value:

- "Why does <underlying thing> happen? Symptom or cause?"
- Verify any assumption the plan makes about the code.
- "What did you consider and reject?"

Send follow-ups until the plan addresses root cause.

Synthesize:

- Convergence -> unified plan.
- Significant divergence -> involve the user.

Confirm the merged plan with both members. Multi-turn until consensus.

## Phase 2: Implement

Default: implement yourself. If the user said **"delegate"**, launch one implementation agent and pass the merged plan.

The committee stays clean: not involved in implementation.

## Phase 3: Review

Send the diff to the committee for review.

## Workflow

1. Write a problem-level prompt.
2. Create both agents in parallel via Otto with `[Committee] <task>` titles and the same prompt.
3. Wait for both responses.
4. Resolve disagreements by passing their arguments between each other.
5. Keep going until they converge into a response.

After about 10 iterations without convergence, start a fresh committee with the full history of what was tried; the current committee's context may have drifted too far.

Share the consensus with the user. Summarize where the agents diverged and how they resolved it.
