// Lightweight, dependency-free language guesser for code fences that arrive
// without an info string. Agents emit bare ``` blocks constantly, so this
// recovers highlighting for them — but it is deliberately conservative: when
// the signals are weak or two languages tie, it returns null and the caller
// renders plain monospace rather than confidently mis-coloring the block.
//
// Every returned extension is a key in parsers.ts's table, so the result plugs
// straight into highlightCode(`x.${ext}`).

// Only look at the head of large blocks — the language is obvious well before
// 4k chars, and detection runs on every streamed chunk.
const SAMPLE_LIMIT = 4000;

// A guess only wins if it clears this score AND beats the runner-up by the
// margin below. Both guard against near-ties on shared signals (import,
// braces, colons) turning into coin-flip highlighting.
const MIN_SCORE = 4;
const MIN_MARGIN = 2;

interface Rule {
  ext: string;
  re: RegExp;
  weight: number;
}

// Ordered loosely by signal strength. `m` (multiline) anchors keep matches to
// line starts where it matters; `i` is used only where a language's keywords
// are conventionally case-insensitive (SQL).
const RULES: Rule[] = [
  // Shell
  {
    ext: "sh",
    re: /^\s*(sudo|apt|apt-get|yum|dnf|brew|npm|npx|yarn|pnpm|pip3?|git|cd|ls|cat|echo|grep|sed|awk|curl|wget|chmod|chown|mkdir|rm|cp|mv|tar|ssh|docker|kubectl|make)\b/m,
    weight: 3,
  },
  { ext: "sh", re: /\$\{?\w+\}?/, weight: 1 },
  { ext: "sh", re: /^\s*(if|then|fi|for|do|done|while|case|esac|function)\b.*;?\s*$/m, weight: 1 },
  { ext: "sh", re: /\|\s*(grep|awk|sed|xargs|head|tail|sort|uniq|wc)\b/, weight: 2 },
  { ext: "sh", re: /^\s*export\s+\w+=/m, weight: 2 },

  // SQL — keyword-insensitive; combos are what make it unambiguous.
  { ext: "sql", re: /\bSELECT\b[\s\S]*\bFROM\b/i, weight: 4 },
  { ext: "sql", re: /\bINSERT\s+INTO\b/i, weight: 4 },
  { ext: "sql", re: /\bUPDATE\b[\s\S]*\bSET\b/i, weight: 4 },
  { ext: "sql", re: /\bDELETE\s+FROM\b/i, weight: 4 },
  { ext: "sql", re: /\bCREATE\s+(TABLE|INDEX|VIEW|DATABASE)\b/i, weight: 4 },
  { ext: "sql", re: /\b(ALTER|DROP)\s+TABLE\b/i, weight: 3 },
  { ext: "sql", re: /\b(INNER|LEFT|RIGHT|OUTER)\s+JOIN\b/i, weight: 2 },

  // Python
  { ext: "py", re: /^\s*def\s+\w+\s*\(/m, weight: 3 },
  { ext: "py", re: /^\s*(from\s+[\w.]+\s+)?import\s+\w/m, weight: 2 },
  { ext: "py", re: /^\s*class\s+\w+[\w(),\s]*:\s*$/m, weight: 3 },
  { ext: "py", re: /\belif\b/, weight: 3 },
  { ext: "py", re: /\bself\b/, weight: 1 },
  { ext: "py", re: /\bprint\s*\(/, weight: 1 },
  { ext: "py", re: /\b(True|False|None)\b/, weight: 1 },
  { ext: "py", re: /^\s*@\w+/m, weight: 1 },

  // JavaScript / TypeScript (folded to ts — its parser handles plain JS)
  { ext: "ts", re: /\b(const|let)\s+\w+\s*=/, weight: 2 },
  { ext: "ts", re: /\bfunction\s*\*?\s*\w*\s*\(/, weight: 2 },
  { ext: "ts", re: /=>\s*[{([]/, weight: 2 },
  { ext: "ts", re: /\bimport\s+[\s\S]*?\bfrom\s+['"]/, weight: 3 },
  { ext: "ts", re: /\bexport\s+(default|const|function|class|async)\b/, weight: 2 },
  { ext: "ts", re: /\bconsole\.(log|error|warn|info)\b/, weight: 2 },
  { ext: "ts", re: /\binterface\s+\w+\s*\{/, weight: 3 },
  { ext: "ts", re: /:\s*(string|number|boolean|void|any|unknown|Promise<)/, weight: 2 },

  // Go
  { ext: "go", re: /^\s*package\s+\w+/m, weight: 4 },
  { ext: "go", re: /^\s*func\s+(\(\w+\s+\*?\w+\)\s+)?\w+\s*\(/m, weight: 3 },
  { ext: "go", re: /:=/, weight: 2 },
  { ext: "go", re: /\bfmt\.\w+\(/, weight: 3 },

  // Rust
  { ext: "rs", re: /^\s*fn\s+\w+/m, weight: 3 },
  { ext: "rs", re: /\blet\s+mut\b/, weight: 3 },
  { ext: "rs", re: /\bprintln!\s*\(/, weight: 3 },
  { ext: "rs", re: /\b(impl|pub\s+fn|use\s+\w+::|match\s+\w+\s*\{)/, weight: 2 },
  { ext: "rs", re: /->\s*[\w<&]/, weight: 1 },

  // Java
  { ext: "java", re: /\bpublic\s+static\s+void\s+main\b/, weight: 5 },
  { ext: "java", re: /\bSystem\.out\.print(ln)?\b/, weight: 4 },
  {
    ext: "java",
    re: /\b(public|private|protected)\s+(static\s+|final\s+)*(class|void|int|String|boolean)\b/,
    weight: 3,
  },
  { ext: "java", re: /^\s*import\s+[\w.]+;\s*$/m, weight: 2 },

  // C / C++
  { ext: "cpp", re: /^\s*#include\s*[<"]/m, weight: 4 },
  { ext: "cpp", re: /\bstd::\w+/, weight: 3 },
  { ext: "cpp", re: /\bint\s+main\s*\(/, weight: 2 },
  { ext: "cpp", re: /\bprintf\s*\(/, weight: 1 },

  // PHP
  { ext: "php", re: /<\?php/, weight: 6 },
  { ext: "php", re: /\$\w+\s*=/, weight: 1 },
  { ext: "php", re: /\becho\s+['"$]/, weight: 1 },

  // HTML
  {
    ext: "html",
    re: /<(!DOCTYPE|html|head|body|div|span|section|article|nav|header|footer|main|script|style|img|input|button|form|table|ul|ol|li|h[1-6])\b/i,
    weight: 3,
  },
  { ext: "html", re: /<\/(div|span|body|html|p|a|section|ul|li|table)>/i, weight: 2 },

  // CSS
  { ext: "css", re: /[.#]?[\w-]+\s*\{[^}]*[\w-]+\s*:[^}]*;/, weight: 3 },
  { ext: "css", re: /@(media|import|keyframes|font-face|supports)\b/, weight: 3 },
  { ext: "css", re: /^\s*[\w-]+\s*:\s*[^;{]+;\s*$/m, weight: 1 },

  // YAML
  { ext: "yaml", re: /^---\s*$/m, weight: 3 },
  { ext: "yaml", re: /^\s*-\s+\w/m, weight: 1 },
  { ext: "yaml", re: /^\s*[\w-]+:\s+\S/m, weight: 1 },
];

function scoreRules(sample: string): Map<string, number> {
  const scores = new Map<string, number>();
  for (const { ext, re, weight } of RULES) {
    if (re.test(sample)) scores.set(ext, (scores.get(ext) ?? 0) + weight);
  }
  return scores;
}

// Best-effort guess of the language extension for a code block, or null when
// there isn't enough signal to be confident.
export function detectLanguage(code: string): string | null {
  const sample = code.length > SAMPLE_LIMIT ? code.slice(0, SAMPLE_LIMIT) : code;
  const trimmed = sample.trim();
  if (trimmed.length < 3) return null;

  // Shebang — the single strongest signal, short-circuit on it.
  if (trimmed.startsWith("#!")) {
    const firstLine = trimmed.slice(
      0,
      trimmed.indexOf("\n") === -1 ? undefined : trimmed.indexOf("\n"),
    );
    if (/\b(bash|zsh|ksh|sh)\b/.test(firstLine)) return "sh";
    if (/\bpython[0-9.]*\b/.test(firstLine)) return "py";
    if (/\bnode\b/.test(firstLine)) return "ts";
  }

  // JSON — structural and cheaply verifiable, so a successful parse is decisive.
  if (/^[[{]/.test(trimmed) && /[\]}]$/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Not valid JSON — likely a JS object literal or a fragment; keep scoring.
    }
  }

  const scores = scoreRules(sample);
  if (scores.size === 0) return null;

  let bestExt: string | null = null;
  let bestScore = 0;
  let runnerUp = 0;
  for (const [ext, score] of scores) {
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      bestExt = ext;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (bestScore < MIN_SCORE) return null;
  if (bestScore - runnerUp < MIN_MARGIN) return null;
  return bestExt;
}
