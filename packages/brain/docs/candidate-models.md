# Candidate models to download

Curated shortlist for **12-32GB-VRAM home hardware**, aimed at **coding +
generative** work: producing logic, financial/marketing prose and analysis,
creating documents, and generating charts/graphs via code (widgets, artifacts).

**One canonical entry per distinct model** (dense _and_ MoE both). Quant, imatrix,
distill, MTP and other re-quant **variants are intentionally excluded** — the base
list stays clean; search Hugging Face directly when you want a specific spin.

Source of truth is [`config/downloads.json`](../config/downloads.json) — edit
that, then keep this table in sync. `~VRAM` is the on-disk GGUF weight size at
the listed quant (approximate); **real KV/context fit must still be measured**
with `npm run calibrate -- --model X`, because the theoretical KV formula
overestimates badly. Repos/files verified against public GGUF releases as of
2026-07 — confirm the exact file before downloading.

Target: keep weights ≈ 12–26GB so headroom stays free for KV cache + context.

## All-rounders (coding + prose + analysis)

| Model                     | Quant  | ~VRAM | Notes                                                                                     |
| ------------------------- | ------ | ----- | ----------------------------------------------------------------------------------------- |
| **Qwen3.6-27B**           | Q5_K_M | ~19GB | Newest Qwen gen, multi-token prediction + vision. **Thinking model** — cap with `sweep`.  |
| **Qwen3-32B**             | Q5_K_M | ~23GB | Strong all-round reasoner + coder. **Thinking model** — cap the budget with `sweep`.      |
| **Qwen3-30B-A3B** (MoE)   | Q5_K_M | ~22GB | ~3B active → very fast daily driver. Thinking model; cap the budget.                      |
| **GLM-4.7-Flash** (MoE)   | Q4_K_M | ~17GB | Strongest 30B-A3B class; 200K window, ~3.6B active. Thinking model; cap the budget.       |
| **Nemotron-3-Nano** (MoE) | Q4_K_M | ~23GB | NVIDIA 30B-A3B reasoner, very long context (confirm ceiling). Thinking; cap the budget.   |
| **gpt-oss-20B** (MoE)     | MXFP4  | ~11GB | Cleanest tool-calls in class; native MXFP4 leaves the most context headroom.              |
| **Ornith-1.0-35B** (MoE)  | Q4_K_S | ~19GB | Vision-capable 35B MoE. Largest pick; Q4_K_S keeps KV headroom. Thinking; cap the budget. |
| **Mistral-Small-3.2-24B** | Q6_K   | ~19GB | No thinking tax, superb instruction-following, reliable document/JSON output. Vision.     |

## Coding & artifact/widget specialists

| Model                                  | Quant  | ~VRAM | Notes                                                                              |
| -------------------------------------- | ------ | ----- | ---------------------------------------------------------------------------------- |
| **Qwen2.5-Coder-32B-Instruct**         | Q4_K_M | ~20GB | Best local coder here; excellent self-contained HTML/React artifacts + chart code. |
| **Qwen3-Coder-30B-A3B-Instruct** (MoE) | Q5_K_M | ~21GB | Coder MoE, fast, agentic tool-use friendly.                                        |
| **GLM-4-32B-0414**                     | Q4_K_M | ~20GB | Strong at single-file front-end web artifacts and interactive widgets.             |
| **Codestral-22B-v0.1**                 | Q6_K   | ~18GB | Fast fill-in-the-middle for editor-style completion.                               |

## Prose / analysis leaning

| Model              | Quant  | ~VRAM | Notes                                                                                |
| ------------------ | ------ | ----- | ------------------------------------------------------------------------------------ |
| **Gemma-4-31B-it** | Q4_K_M | ~17GB | Newer Gemma gen, dense + vision. Strong prose/tone. High KV — measure context fit.   |
| **Gemma-3-27B-it** | Q4_K_M | ~17GB | Best prose/tone for marketing & financial writing. Multimodal (reads charts/images). |
| **Phi-4 (14B)**    | Q8_0   | ~16GB | Above-weight structured reasoning/analysis; most VRAM left for context.              |

## Document ingestion companion

| Model              | Quant | ~VRAM | Notes                                                                                                        |
| ------------------ | ----- | ----- | ------------------------------------------------------------------------------------------------------------ |
| **DeepSeek-OCR-2** | Q8_0  | ~3GB  | Doc/PDF OCR that rides alongside anything else. **Needs a specific llama.cpp PR branch**, not upstream main. |

## Suggested first three to test

1. **Qwen3.6-27B** — top all-rounder, vision
2. **GLM-4.7-Flash** — strongest 30B-A3B class, 200K context
3. **gpt-oss-20B** — cleanest tool-calls, most context headroom

## Workflow per model, after download

1. `npm run calibrate -- --model X` — measure real KV bytes/token, save to `config/profiles.json`.
2. For any **thinking** model (Qwen3 family, GLM-4.7-Flash, Nemotron, gpt-oss, Ornith): `npm run sweep -- --model X` to find the reasoning-budget cap before trusting it for documents/charts (otherwise it defaults to `-1` and can return zero content).
3. Keep the default `q8_0` KV + flash attention to stretch context without much quality loss.
