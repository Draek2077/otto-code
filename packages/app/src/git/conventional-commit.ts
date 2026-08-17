/**
 * Conventional Commits (git-cz style) helpers for the manual commit UI in the
 * Changes panel.
 *
 * The daemon runs `git commit -m <message>` with whatever string the client
 * sends, so the type prefix is applied here, client-side: the user picks a
 * type in the commit form, and the final message is built as `type: subject`.
 */

/** The commit types git-cz offers, in the order its prompt lists them. */
export const CONVENTIONAL_COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

export type ConventionalCommitType = (typeof CONVENTIONAL_COMMIT_TYPES)[number];

/** "No type" - the message is committed as-is, with no prefix. */
export const NO_COMMIT_TYPE = "none" as const;

export type CommitTypeChoice = ConventionalCommitType | typeof NO_COMMIT_TYPE;

/**
 * A message the user already wrote as a full conventional header, optionally
 * scoped and breaking: `fix: x`, `fix(api): x`, `feat!: x`, `feat(api)!: x`.
 * Detected so we never double-prefix a message that already carries one.
 */
const CONVENTIONAL_HEADER = /^\w+(\([^)]*\))?!?:\s/;

/**
 * Build the commit message the way git-cz formats it: `type: subject`.
 *
 * The subject is trimmed. When no type is selected, or the subject already
 * starts with a conventional header, the (trimmed) subject is returned
 * unchanged - a user who typed the prefix by hand keeps exactly what they typed.
 */
export function formatConventionalCommitMessage(
  type: CommitTypeChoice,
  rawMessage: string,
): string {
  const subject = rawMessage.trim();
  if (!subject) {
    return subject;
  }
  if (type === NO_COMMIT_TYPE || CONVENTIONAL_HEADER.test(subject)) {
    return subject;
  }
  return `${type}: ${subject}`;
}
