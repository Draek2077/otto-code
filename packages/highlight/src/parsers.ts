import { StreamLanguage } from "@codemirror/language";
import { dart } from "@codemirror/legacy-modes/mode/clike";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
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
import { csharpLanguage } from "@replit/codemirror-lang-csharp";
import { parser as elixirParser } from "lezer-elixir";
import type { Parser } from "@lezer/common";

// Shared instance so the four shell fence aliases don't each build a grammar.
const shellParser = StreamLanguage.define(shell).parser;

const parsersByExtension: Record<string, Parser> = {
  // JavaScript/TypeScript
  js: jsParser,
  jsx: jsParser.configure({ dialect: "jsx" }),
  ts: jsParser.configure({ dialect: "ts" }),
  tsx: jsParser.configure({ dialect: "ts jsx" }),
  mjs: jsParser,
  cjs: jsParser,
  // C / C++ / Objective-C
  c: cppParser,
  h: cppParser,
  cc: cppParser,
  cpp: cppParser,
  cxx: cppParser,
  hpp: cppParser,
  hxx: cppParser,
  m: cppParser,
  mm: cppParser,
  // JSON
  json: jsonParser,
  // CSS
  css: cssParser,
  scss: cssParser,
  // HTML
  html: htmlParser,
  htm: htmlParser,
  // XML
  xml: xmlParser,
  // Java
  java: javaParser,
  // Python
  py: pythonParser,
  // Go
  go: goParser,
  // PHP
  php: phpParser,
  // YAML
  yaml: yamlParser,
  yml: yamlParser,
  // Rust
  rs: rustParser,
  // Swift
  swift: StreamLanguage.define(swift).parser,
  // Dart
  dart: StreamLanguage.define(dart).parser,
  // Shell (fence tags bash/sh/zsh/shell all map here)
  sh: shellParser,
  bash: shellParser,
  zsh: shellParser,
  shell: shellParser,
  // SQL
  sql: StreamLanguage.define(standardSQL).parser,
  // C#
  cs: csharpLanguage.parser,
  // Elixir
  ex: elixirParser,
  exs: elixirParser,
  // Markdown
  md: markdownParser,
  mdx: markdownParser,
};

export function getParserForFile(filename: string): Parser | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return parsersByExtension[ext] ?? null;
}

export function isLanguageSupported(filename: string): boolean {
  return getParserForFile(filename) !== null;
}

export function getSupportedExtensions(): string[] {
  return Object.keys(parsersByExtension);
}
