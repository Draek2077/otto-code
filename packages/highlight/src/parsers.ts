import { defineLanguageFacet, Language, StreamLanguage } from "@codemirror/language";
import { dart } from "@codemirror/legacy-modes/mode/clike";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { parser as jsParser } from "@lezer/javascript";
import { parser as jsonParser } from "@lezer/json";
import { parser as cssParser } from "@lezer/css";
import { parser as cppParser } from "@lezer/cpp";
import { parser as goParser } from "@lezer/go";
import { parser as htmlParser } from "@lezer/html";
import { parser as javaParser } from "@lezer/java";
import { parser as pythonParser } from "@lezer/python";
import { parser as markdownParser } from "@lezer/markdown";
import { parser as phpParser } from "@lezer/php";
import { parser as rustParser } from "@lezer/rust";
import { parser as xmlParser } from "@lezer/xml";
import { parser as yamlParser } from "@lezer/yaml";
import { parser as elixirParser } from "lezer-elixir";
import type { Parser } from "@lezer/common";
import { csharpLanguage } from "./csharp/language.js";
import { nixLanguage } from "./nix/language.js";
import { parser as svelteBaseParser } from "./svelte/parser.js";
import { configureNesting, defaultNesting } from "./svelte/nesting.js";

function language(parser: Parser): Language {
  return new Language(defineLanguageFacet(), parser);
}

// Shared instance so the four shell fence aliases don't each build a grammar.
const shellLanguage = StreamLanguage.define(shell);

const languagesByExtension: Record<string, Language> = {
  // JavaScript/TypeScript
  js: language(jsParser),
  jsx: language(jsParser.configure({ dialect: "jsx" })),
  ts: language(jsParser.configure({ dialect: "ts" })),
  tsx: language(jsParser.configure({ dialect: "ts jsx" })),
  mjs: language(jsParser),
  cjs: language(jsParser),
  // C / C++ / Objective-C
  c: language(cppParser),
  h: language(cppParser),
  cc: language(cppParser),
  cpp: language(cppParser),
  cxx: language(cppParser),
  hpp: language(cppParser),
  hxx: language(cppParser),
  m: language(cppParser),
  mm: language(cppParser),
  // JSON
  json: language(jsonParser),
  // CSS
  css: language(cssParser),
  scss: language(cssParser),
  // HTML
  html: language(htmlParser),
  htm: language(htmlParser),
  // Svelte
  svelte: language(svelteBaseParser.configure({ wrap: configureNesting(defaultNesting) })),
  // XML
  xml: language(xmlParser),
  // Java
  java: language(javaParser),
  // Python
  py: language(pythonParser),
  // Go
  go: language(goParser),
  // PHP
  php: language(phpParser),
  // YAML
  yaml: language(yamlParser),
  yml: language(yamlParser),
  // Rust
  rs: language(rustParser),
  // Swift
  swift: StreamLanguage.define(swift),
  // Dart
  dart: StreamLanguage.define(dart),
  // C#
  cs: csharpLanguage,
  // Nix
  nix: nixLanguage,
  // Elixir
  ex: language(elixirParser),
  exs: language(elixirParser),
  // Markdown
  md: language(markdownParser),
  mdx: language(markdownParser),
  // Shell. `detect.ts` has scored shell since it was written and can return
  // "sh", so without these rows we classified a snippet as shell and then had
  // nothing to colour it with. Lost in the Otto v0.2.5 merge when this table
  // took upstream's shape; see projects/otto-v025-merge/audit-findings.md.
  // All four fence tags (sh/bash/zsh/shell) map here.
  sh: shellLanguage,
  bash: shellLanguage,
  zsh: shellLanguage,
  shell: shellLanguage,
  // SQL. Same story: "sql" is a detect.ts verdict. `standardSQL` is the dialect
  // -neutral mode, which is the right default for snippets of unknown origin.
  sql: StreamLanguage.define(standardSQL),
};

export function getLanguageForFile(filename: string): Language | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return languagesByExtension[ext] ?? null;
}

export function getParserForFile(filename: string): Parser | null {
  return getLanguageForFile(filename)?.parser ?? null;
}

export function isLanguageSupported(filename: string): boolean {
  return getParserForFile(filename) !== null;
}

export function getSupportedExtensions(): string[] {
  return Object.keys(languagesByExtension);
}
