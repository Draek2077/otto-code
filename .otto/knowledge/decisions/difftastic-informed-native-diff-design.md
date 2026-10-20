---
id: "difftastic-informed-native-diff-design"
kind: "decision"
title: "Difftastic-informed native diff design"
status: "confirmed"
tags: ["difftastic", "diffs", "architecture", "review"]
created_at: "2026-08-13T02:09:43.518Z"
updated_at: "2026-08-13T02:29:37.366Z"
---

# Difftastic-informed native diff design

<!-- compiled_truth -->

Otto will not vendor or embed Difftastic’s implementation. Difftastic will inform Otto's native diff design and serve as a benchmark/oracle through a version-pinned, curated subset of its fixture corpus, retained with provenance and applicable license notices. Otto retains its own review-grade semantic DiffDocument and renderers so comments, review targets, source mapping, actions, accessibility, and local settings work uniformly across providers and diff surfaces. The Difftastic-derived principles to adopt are syntax-aware matching, shared unchanged context, character-level change emphasis, conservative line fallback, a representative structural-diff corpus, and fast pure-unit evaluation of every supported language/rule. The corpus must not be a test-time dependency on the Difftastic binary: Otto assertions run locally and deterministically, while Difftastic remains an optional benchmark oracle when adding or recalibrating fixtures.

## Timeline

- time: "2026-08-13T02:09:43.518Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["structural-diff-review-experience","diff-review-experience"]
- time: "2026-08-13T02:09:43.518Z"
  kind: "evidence"
  summary: "User decision on 2026-08-13 after reviewing Difftastic's architecture and the in-app visual spike. Difftastic is MIT licensed but is a Rust CLI with terminal-oriented output and its own third-party parser license set; its README says it is intended for human display and does not generate patches."
- time: "2026-08-13T02:22:41.945Z"
  kind: "evidence"
  summary: "Reviewed Difftastic’s internals: its quality comes from both a syntax-tree graph search (lazy Dijkstra route finding) and a maintained per-language configuration layer for atom nodes, delimiters, language detection, highlighting, and regression fixtures. This reinforces that a generic line/token matcher alone cannot claim Difftastic-level structural behavior."
  source: "https://difftastic.wilfred.me.uk/diffing.html and https://difftastic.wilfred.me.uk/adding_a_parser.html"
  affects: ["structural-diff-review-experience","diff-review-experience"]
- time: "2026-08-13T02:28:30.359Z"
  kind: "decision"
  summary: "The user approved vendoring a curated Difftastic fixture corpus and required a fast iterative unit-test loop rather than costly full application runs."
  source: "User implementation and quality decision, 2026-08-13"
  affects: ["structural-diff-review-experience","diff-review-experience"]
- time: "2026-08-13T02:29:37.366Z"
  kind: "evidence"
  summary: "Difftastic’s end-to-end corpus harness builds the release binary, runs every paired sample deterministically at a fixed width and colour mode, hashes each rendered result, and compares those hashes to a checked-in baseline. Otto should adopt the same two-tier shape but use semantic contracts for its fast inner unit loop and reserve a rendered-artifact baseline for an explicit slower visual regression gate."
  source: "https://github.com/Wilfred/difftastic/blob/master/sample_files/compare_all.sh"
  affects: ["structural-diff-review-experience","diff-review-experience"]
