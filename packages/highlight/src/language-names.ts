// Human-readable language labels for UI chrome (the editor status bar).
//
// Deliberately NOT derived from `parsersByExtension`: the editor opens any text
// file, so this has to name plenty of formats we have no grammar for (TOML,
// INI, CSV…). A missing grammar means no syntax colors, not "unknown file".

const NAMES_BY_EXTENSION: Record<string, string> = {
  // JavaScript/TypeScript
  js: "JavaScript",
  jsx: "JavaScript JSX",
  mjs: "JavaScript",
  cjs: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript JSX",
  mts: "TypeScript",
  cts: "TypeScript",
  // C family
  c: "C",
  h: "C Header",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++ Header",
  hxx: "C++ Header",
  m: "Objective-C",
  mm: "Objective-C++",
  cs: "C#",
  // Web
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  scss: "Sass",
  sass: "Sass",
  less: "Less",
  vue: "Vue",
  svelte: "Svelte",
  // Data / config
  json: "JSON",
  jsonc: "JSON with Comments",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  ini: "INI",
  cfg: "INI",
  conf: "Config",
  env: "Environment",
  properties: "Properties",
  csv: "CSV",
  tsv: "TSV",
  // Other languages
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  py: "Python",
  pyi: "Python Stub",
  go: "Go",
  php: "PHP",
  rb: "Ruby",
  rs: "Rust",
  swift: "Swift",
  dart: "Dart",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  lua: "Lua",
  pl: "Perl",
  r: "R",
  scala: "Scala",
  clj: "Clojure",
  zig: "Zig",
  // Shell
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  fish: "Shell",
  shell: "Shell",
  ps1: "PowerShell",
  psm1: "PowerShell",
  bat: "Batch",
  cmd: "Batch",
  // Query / markup / docs
  sql: "SQL",
  graphql: "GraphQL",
  gql: "GraphQL",
  proto: "Protocol Buffers",
  md: "Markdown",
  mdx: "MDX",
  markdown: "Markdown",
  rst: "reStructuredText",
  adoc: "AsciiDoc",
  asciidoc: "AsciiDoc",
  tex: "LaTeX",
  txt: "Plain Text",
  log: "Log",
  // Version control / tooling
  gitignore: "Git Ignore",
  gitattributes: "Git Attributes",
  dockerignore: "Docker Ignore",
  editorconfig: "EditorConfig",
  lock: "Lock File",
  patch: "Patch",
  diff: "Diff",
};

// Files whose whole name carries the type, with no extension to read.
const NAMES_BY_FILENAME: Record<string, string> = {
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  gnumakefile: "Makefile",
  rakefile: "Ruby",
  gemfile: "Ruby",
  procfile: "Procfile",
  license: "License",
  readme: "Plain Text",
  notice: "Plain Text",
};

/**
 * A label for the editor status bar — never empty. Unknown extensions fall back
 * to the extension itself in caps ("TOML" before it was listed above), which
 * still tells the user more than "Unknown" would.
 */
export function getLanguageDisplayName(filename: string): string {
  const basename = filename.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (!basename) {
    return "Plain Text";
  }
  const byFilename = NAMES_BY_FILENAME[basename];
  if (byFilename) {
    return byFilename;
  }
  // A leading dot is part of the name, not an extension separator: ".gitignore"
  // has to read as "gitignore", not as an empty extension.
  const withoutLeadingDot = basename.startsWith(".") ? basename.slice(1) : basename;
  const dot = withoutLeadingDot.lastIndexOf(".");
  const extension = dot === -1 ? withoutLeadingDot : withoutLeadingDot.slice(dot + 1);
  if (!extension) {
    return "Plain Text";
  }
  return NAMES_BY_EXTENSION[extension] ?? extension.toUpperCase();
}
