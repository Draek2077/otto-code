import { z } from "zod";
export interface DiffSegment {
  text: string;
  changed: boolean;
}

/**
 * The daemon protocol transports syntax roles as strings so a newer host can
 * add a role without breaking an older client. Renderers map unknown roles to
 * their base code color.
 */
export interface DiffToken {
  text: string;
  style: string | null;
}

export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  /** 1-based source coordinate before the change, when the producer knows it. */
  oldLineNumber?: number;
  /** 1-based source coordinate after the change, when the producer knows it. */
  newLineNumber?: number;
  segments?: DiffSegment[];
  // Syntax-highlight tokens for the code on this line (prefix char excluded),
  // attached by highlightDiffLines when the file's language is supported.
  tokens?: DiffToken[];
}

function splitIntoLines(text: string): string[] {
  if (!text) {
    return [];
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // A terminal newline terminates the final source line; it is not an extra
  // empty display line. Preserve deliberate blank lines before that newline.
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function splitIntoWords(text: string): string[] {
  const result: string[] = [];
  let current = "";
  let inWord = false;

  for (const char of text) {
    const isWordChar = /\w/.test(char);
    if (isWordChar) {
      if (!inWord && current) {
        result.push(current);
        current = "";
      }
      inWord = true;
      current += char;
    } else {
      if (inWord && current) {
        result.push(current);
        current = "";
      }
      inWord = false;
      current += char;
    }
  }
  if (current) {
    result.push(current);
  }
  return result;
}

function computeWordLevelDiff(
  oldLine: string,
  newLine: string,
): { oldSegments: DiffSegment[]; newSegments: DiffSegment[] } {
  const oldWords = splitIntoWords(oldLine);
  const newWords = splitIntoWords(newLine);

  const m = oldWords.length;
  const n = newWords.length;

  // LCS to find common words
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (oldWords[i] === newWords[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Mark which words are in LCS (unchanged)
  const oldInLCS = new Set<number>();
  const newInLCS = new Set<number>();

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldWords[i] === newWords[j]) {
      oldInLCS.add(i);
      newInLCS.add(j);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  // Build segments: consecutive unchanged or changed words merged
  const buildSegments = (words: string[], inLCS: Set<number>): DiffSegment[] => {
    if (words.length === 0) return [];

    const segments: DiffSegment[] = [];
    let currentText = "";
    let currentChanged: boolean | null = null;

    for (let idx = 0; idx < words.length; idx++) {
      const word = words[idx];
      const changed = !inLCS.has(idx);

      if (currentChanged === null) {
        currentText = word;
        currentChanged = changed;
      } else if (changed === currentChanged) {
        currentText += word;
      } else {
        segments.push({ text: currentText, changed: currentChanged });
        currentText = word;
        currentChanged = changed;
      }
    }

    if (currentText) {
      segments.push({ text: currentText, changed: currentChanged ?? false });
    }

    return segments;
  };

  const oldSegments = buildSegments(oldWords, oldInLCS);
  const newSegments = buildSegments(newWords, newInLCS);

  return {
    oldSegments,
    newSegments,
  };
}

function addSingleLineIntralineSegments(diff: DiffLine[]): void {
  // Only attach intraline segments when a complete changed run has one line
  // on each side. A multi-line run can contain wrapping, insertion, movement,
  // or reordered statements. Pairing arbitrary adjacent `-` and `+` lines in
  // that run gives the fragments the wrong counterpart and can make unchanged
  // text appear highlighted in a Structural view.
  for (let start = 0; start < diff.length; ) {
    if (diff[start]?.type !== "remove" && diff[start]?.type !== "add") {
      start += 1;
      continue;
    }
    let end = start;
    const removals: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (end < diff.length && (diff[end]?.type === "remove" || diff[end]?.type === "add")) {
      const line = diff[end]!;
      if (line.type === "remove") removals.push(line);
      else additions.push(line);
      end += 1;
    }
    if (removals.length === 1 && additions.length === 1) {
      const { oldSegments, newSegments } = computeWordLevelDiff(
        removals[0]!.content.slice(1),
        additions[0]!.content.slice(1),
      );
      removals[0]!.segments = oldSegments;
      additions[0]!.segments = newSegments;
    }
    start = end;
  }
}

export function buildLineDiff(originalText: string, updatedText: string): DiffLine[] {
  const originalLines = splitIntoLines(originalText);
  const updatedLines = splitIntoLines(updatedText);

  const hasAnyContent = originalLines.length > 0 || updatedLines.length > 0;
  if (!hasAnyContent) {
    return [];
  }

  const m = originalLines.length;
  const n = updatedLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (originalLines[i] === updatedLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff: DiffLine[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (originalLines[i] === updatedLines[j]) {
      diff.push({
        type: "context",
        content: ` ${originalLines[i]}`,
        oldLineNumber,
        newLineNumber,
      });
      i += 1;
      j += 1;
      oldLineNumber += 1;
      newLineNumber += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: "remove", content: `-${originalLines[i]}`, oldLineNumber });
      i += 1;
      oldLineNumber += 1;
    } else {
      diff.push({ type: "add", content: `+${updatedLines[j]}`, newLineNumber });
      j += 1;
      newLineNumber += 1;
    }
  }

  while (i < m) {
    diff.push({ type: "remove", content: `-${originalLines[i]}`, oldLineNumber });
    i += 1;
    oldLineNumber += 1;
  }

  while (j < n) {
    diff.push({ type: "add", content: `+${updatedLines[j]}`, newLineNumber });
    j += 1;
    newLineNumber += 1;
  }

  addSingleLineIntralineSegments(diff);

  return diff;
}

export function parseUnifiedDiff(diffText?: string): DiffLine[] {
  if (!diffText) {
    return [];
  }

  const lines = splitIntoLines(diffText);
  const diff: DiffLine[] = [];
  let oldLineNumber: number | undefined;
  let newLineNumber: number | undefined;

  for (const line of lines) {
    if (!line.length) {
      diff.push({ type: "context", content: line });
      continue;
    }

    if (line.startsWith("@@")) {
      diff.push({ type: "header", content: line });
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldLineNumber = hunk ? Number(hunk[1]) : undefined;
      newLineNumber = hunk ? Number(hunk[2]) : undefined;
      continue;
    }

    if (line.startsWith("+")) {
      if (!line.startsWith("+++")) {
        diff.push({ type: "add", content: line, newLineNumber });
        if (newLineNumber !== undefined) newLineNumber += 1;
      }
      continue;
    }

    if (line.startsWith("-")) {
      if (!line.startsWith("---")) {
        diff.push({ type: "remove", content: line, oldLineNumber });
        if (oldLineNumber !== undefined) oldLineNumber += 1;
      }
      continue;
    }

    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      continue;
    }

    if (line.startsWith("\\ No newline")) {
      diff.push({ type: "header", content: line });
      continue;
    }

    diff.push({ type: "context", content: line, oldLineNumber, newLineNumber });
    if (oldLineNumber !== undefined) oldLineNumber += 1;
    if (newLineNumber !== undefined) newLineNumber += 1;
  }

  return diff;
}

// ---- Task Extraction (cross-provider) ----

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface TaskEntry {
  text: string;
  status: TaskStatus;
  completed: boolean;
}

const TaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);

const ClaudeTodoWriteSchema = z.object({
  todos: z.array(
    z.object({
      content: z.string(),
      status: TaskStatusSchema,
      activeForm: z.string().optional(),
    }),
  ),
});

const UpdatePlanSchema = z.object({
  plan: z.array(
    z.object({
      step: z.string(),
      status: TaskStatusSchema.catch("pending"),
    }),
  ),
});

function normalizeToolName(toolName: string): string {
  return toolName
    .trim()
    .replace(/[.\s-]+/g, "_")
    .toLowerCase();
}

export function extractTaskEntriesFromToolCall(
  toolName: string,
  input: unknown,
): TaskEntry[] | null {
  const normalized = normalizeToolName(toolName);

  // Claude's plan mode uses ExitPlanMode for the approval prompt; it is not a task list.
  if (normalized === "exitplanmode") {
    return null;
  }

  if (normalized === "todowrite" || normalized === "todo_write") {
    const parsed = ClaudeTodoWriteSchema.safeParse(input);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.todos.map((todo) => {
      const status = todo.status;
      const text = todo.activeForm?.trim() || todo.content.trim();
      return {
        text: text.length ? text : todo.content,
        status,
        completed: status === "completed",
      };
    });
  }

  if (normalized === "update_plan") {
    const parsed = UpdatePlanSchema.safeParse(input);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.plan
      .map((entry) => ({
        text: entry.step.trim(),
        status: entry.status,
        completed: entry.status === "completed",
      }))
      .filter((entry) => entry.text.length > 0);
  }

  return null;
}

// ---- Incremental checklist tools (Claude Agent SDK: TaskCreate/TaskUpdate/TaskList) ----
//
// Unlike TodoWrite/update_plan (which resend the whole list every call), these
// tools mutate one task at a time and identify tasks by an `id` the SDK assigns.
// TaskCreate returns that id in its OUTPUT; TaskUpdate/TaskList reference it. The
// reducer accumulates these ops into one evolving checklist - see stream.ts.

/**
 * A single mutation to the running checklist, extracted from one completed
 * Task* tool call. `sync` (from TaskList) is authoritative and replaces the set.
 */
export type TaskListOperation =
  | { kind: "create"; id: string | null; text: string }
  | { kind: "update"; id: string; status?: TaskStatus; text?: string; deleted?: boolean }
  | { kind: "sync"; tasks: { id: string; text: string; status: TaskStatus }[] };

const CHECKLIST_TASK_TOOLS = new Set(["taskcreate", "taskupdate", "tasklist", "taskget"]);

/**
 * The checklist Task* family, by normalized name. Note this deliberately does
 * NOT match the bare `Task` tool (subagent fan-out) or `TaskOutput`/`TaskStop`
 * (background-task control) - only the todo-list tools.
 */
export function isChecklistTaskTool(toolName: string): boolean {
  return CHECKLIST_TASK_TOOLS.has(normalizeToolName(toolName));
}

const TaskCreateInputSchema = z.object({ subject: z.string() });
const TaskCreateOutputSchema = z.object({ task: z.object({ id: z.string() }) });
const TaskUpdateInputSchema = z.object({
  taskId: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "deleted"]).optional(),
  subject: z.string().optional(),
});
const TaskListOutputSchema = z.object({
  tasks: z.array(z.object({ id: z.string(), subject: z.string(), status: TaskStatusSchema })),
});

// Tool I/O may reach us as a structured object or a JSON-encoded string,
// depending on how the provider serializes the result - tolerate both.
function coerceToolPayload(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function extractTaskListOperation(
  toolName: string,
  input: unknown,
  output: unknown,
): TaskListOperation | null {
  const normalized = normalizeToolName(toolName);
  const inputRecord = coerceToolPayload(input);
  const outputRecord = coerceToolPayload(output);

  if (normalized === "taskcreate") {
    const parsedInput = TaskCreateInputSchema.safeParse(inputRecord);
    if (!parsedInput.success) {
      return null;
    }
    const text = parsedInput.data.subject.trim();
    if (!text) {
      return null;
    }
    const parsedOutput = TaskCreateOutputSchema.safeParse(outputRecord);
    return { kind: "create", id: parsedOutput.success ? parsedOutput.data.task.id : null, text };
  }

  if (normalized === "taskupdate") {
    const parsedInput = TaskUpdateInputSchema.safeParse(inputRecord);
    if (!parsedInput.success) {
      return null;
    }
    const { taskId, status, subject } = parsedInput.data;
    if (status === "deleted") {
      return { kind: "update", id: taskId, deleted: true };
    }
    // `status` is now narrowed to TaskStatus | undefined (deleted handled above).
    const text = subject?.trim();
    return {
      kind: "update",
      id: taskId,
      status,
      text: text && text.length > 0 ? text : undefined,
    };
  }

  if (normalized === "tasklist") {
    const parsedOutput = TaskListOutputSchema.safeParse(outputRecord);
    if (!parsedOutput.success) {
      return null;
    }
    return {
      kind: "sync",
      tasks: parsedOutput.data.tasks.map((task) => ({
        id: task.id,
        text: task.subject,
        status: task.status,
      })),
    };
  }

  // taskget and anything else in the family are reads - no list mutation.
  return null;
}
