---
id: "reasoning-format-has-no-qwen3-value-and-cannot-fix-the-spurious-mid-thought"
kind: "finding"
title: "--reasoning-format has no qwen3 value and cannot fix the spurious mid-thought split"
status: "proposed"
tags: []
created_at: "2026-08-17T03:20:39.418Z"
updated_at: "2026-08-17T03:20:39.418Z"
---

# --reasoning-format has no qwen3 value and cannot fix the spurious mid-thought split

<!-- compiled_truth -->

Wiring `--reasoning-format qwen3` for Qwen3-class models (the proposed source-side complement to the one-delta hold repair) is not executable and no change was made to packages/brain/src/runtime/args.ts. llama.cpp's `--reasoning-format` accepts only none / auto / deepseek / deepseek-legacy, verified in the pinned build b10265 source (common/arg.cpp:3579 help text; common/common.h:419-427 enum `COMMON_REASONING_FORMAT_{NONE,AUTO,DEEPSEEK_LEGACY,DEEPSEEK}`; common/chat.cpp:841-855 `common_reasoning_format_from_name`) and in current master. An unknown value throws `std::runtime_error("Unknown reasoning format: qwen3")` during argument parsing, so passing it crashes llama-server at startup. Qwen's own docs (qwen.readthedocs.io run_locally/llama.cpp) recommend `--reasoning-format deepseek` for Qwen3. Upstream PR #15408 (merged 2025-08-19, referenced by the enum's "do not extend this enum" comment) states the flag "solely determines the API schema, it is unrelated to the notion of parser or anything at chat template layer. Parser is determined by the chat template itself" and that `common_reasoning_format` "should not be touched anymore". The pinned build b10265 already defaults to deepseek-equivalent extraction (`common_params::reasoning_format = COMMON_REASONING_FORMAT_DEEPSEEK`, common.h:640; AUTO is documented as "Same as deepseek"), so the streaming reasoning→content split is already driven by template-based think-tag detection, and no valid flag value changes how a spurious mid-thought `

## Timeline

- time: "2026-08-17T03:20:39.418Z"
  kind: "decision"
  summary: "Knowledge page created."
