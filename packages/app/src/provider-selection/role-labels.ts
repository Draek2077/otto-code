// Shared display strings for personality roles. Keyed exhaustively by
// PersonalityRole so adding a new role forces both maps to be updated in one
// place (typecheck fails otherwise). Imported by the personalities editor, the
// teams settings section, and the setup-wizard team step — keep these three in
// sync by importing from here, not re-declaring.
import type { PersonalityRole } from "@otto-code/protocol/messages";

export const ROLE_LABELS: Record<PersonalityRole, string> = {
  chatter: "Chatter",
  artificer: "Artificer",
  scheduler: "Scheduler",
  researcher: "Researcher",
  planner: "Planner",
  judger: "Judger",
  advisor: "Advisor",
  coder: "Coder",
  designer: "Designer",
  writer: "Writer",
  orchestrator: "Orchestrator",
};

export const ROLE_HINTS: Record<PersonalityRole, string> = {
  chatter: "Interactive agent chats",
  artificer: "Creating & managing artifacts",
  scheduler: "Creating & managing schedules",
  researcher: "Read-only survey of code / domain (facts, not solutions)",
  planner: "Drafts a typed, sequenced plan for the team to execute",
  judger: "Judging / review passes (structured verdict)",
  advisor: "Second opinion / recommendation (read-only)",
  coder: "Spawned as a coding sub-agent",
  designer: "Styling, layout & human-skill text (copy, naming)",
  writer: "Fast small-text generation (commit messages, summaries, names)",
  orchestrator: "The sole conductor — plans & drives a multi-agent team",
};
