---
id: "language-expansion"
kind: "project"
title: "Language expansion"
status: "proposed"
tags: ["languages", "syntax-highlighting", "parsers", "structural-diff", "developer-experience"]
delivery_status: "deferred"
created_at: "2026-08-13T02:55:28.336Z"
updated_at: "2026-08-13T02:55:28.336Z"
---

# Language expansion

<!-- compiled_truth -->

# Outcome

Expand Otto's language support so developer-relevant languages and structured formats receive coherent syntax highlighting, parser-backed editor features, and the same Structural diff quality contract as existing supported languages.

This project begins only after [[structural-diff-review-experience]] reaches its approved Difftastic-quality delivery gate. It must not interrupt the current Structural diff work.

## Scope

- Establish one authoritative language-capability registry. For every extension or language, record highlighting/parser availability, display name, structural-diff status, fixture coverage, and explicit fallback behavior.
- Remove current registry drift: an extension must never be advertised as parser- or Structural-capable if Otto cannot actually parse/highlight it.
- Add missing developer-relevant languages and structured formats in vertical slices: parser, syntax roles, language detection, display name, fixtures, and Structural-diff corpus coverage.
- Prioritize common project/configuration formats first: TOML, HCL/Terraform, Dockerfile, Makefile, CMake, and Proto; then Ruby, Kotlin, Lua, Clojure, Scala, Nix, Zig, Vue, Svelte, Astro, and GraphQL.
- Use Difftastic's language catalogue and fixture corpus as research/reference input where licensing and parser maintenance allow, without embedding Difftastic itself.

## Constraints

- A newly supported language is not complete if only its editor coloring works. It needs a maintained parser, deterministic unit coverage, and an explicit Structural behavior or a complete Line fallback.
- Do not fork or vendor parsers casually. Prefer maintained compatible parser packages; retain provenance and license notices when fixture or parser source is copied.
- The language registry is the source of truth for extension mapping. Highlighting, detection, editor capabilities, and Structural eligibility must derive from it or validate against it.
- Keep app startup and the fast Structural fixture loop lightweight. Loading a parser must be justified by product value and tested.
- Structural view remains conservative: parser confidence, invalid input, unsupported constructs, binary data, and size limits must choose complete Line fallback with a reason.

## Acceptance criteria

- One tested capability registry covers every language Otto currently supports and prevents registry drift.
- Every existing language is classified Structural-ready, actively-building, or Line-fallback with a reason.
- Each added language ships parser/highlight/detection/display-name coverage and focused fixtures.
- Each Structural-ready language has the required source-pair scenarios in the fast corpus, including formatting, nested changes, additions/removals, and malformed-input behavior where applicable.
- The Settings visual lab can draw representative cases from the corpus without inventing a second scenario set.
- Documentation names the capability registry and the procedure for adding a language.

## Delivery sequence

1. Complete the Structural diff engine and cross-surface review-parity gates.
2. Consolidate and test the language-capability registry; repair existing drift.
3. Add configuration/project formats in vertical slices.
4. Add programming-language families in vertical slices, guided by real Otto usage and maintained parser availability.
5. Expand the fixture corpus and visual lab from the supported registry; publish the coverage status.

## References

- [[language-support-grows-with-structural-diff]]
- [[diff-review-experience]]
- [[difftastic-informed-native-diff-design]]
- [Difftastic language support](https://difftastic.wilfred.me.uk/languages_supported.html)

## Timeline

- time: "2026-08-13T02:55:28.336Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["structural-diff-review-experience","diff-review-experience","language-support-grows-with-structural-diff"]
- time: "2026-08-13T02:55:28.336Z"
  kind: "evidence"
  summary: "User direction on 2026-08-13: finish the Difftastic/Structural diff upgrades first, then expand Otto language support promptly and comprehensively."
