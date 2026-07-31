# Candidate models to download

Curated shortlist for a **32GB-VRAM / 64GB-RAM (discrete GPU)** box, aimed at
**coding + generative** work: producing logic, financial/marketing prose and
analysis, creating documents, and generating charts/graphs via code (widgets,
artifacts).

Source of truth is [`config/downloads.json`](../config/downloads.json) — edit
that, then keep this table in sync. `~VRAM` is the on-disk GGUF weight size at
the listed quant (approximate); **real KV/context fit must still be measured**
with `npm run calibrate -- --model X`, because the theoretical KV formula
overestimates badly. Sizes/repos verified against public GGUF releases as of
2026-01 — confirm the exact file before downloading.

Target: keep weights ≈ 20–26GB so 6–10GB stays free for KV cache + context.

## All-rounders (coding + prose + analysis)

| Model                     | Quant  | ~VRAM | Notes                                                                                   |
| ------------------------- | ------ | ----- | --------------------------------------------------------------------------------------- |
| **Qwen3-32B**             | Q5_K_M | ~23GB | Strongest all-round reasoner + coder. **Thinking model** — cap the budget with `sweep`. |
| **Qwen3-30B-A3B** (MoE)   | Q5_K_M | ~22GB | ~3B active → very fast daily driver. Thinking model; cap the budget.                    |
| **Mistral-Small-3.2-24B** | Q6_K   | ~19GB | No thinking tax, superb instruction-following, reliable document/JSON output. Vision.   |

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
| **Gemma-3-27B-it** | Q4_K_M | ~17GB | Best prose/tone for marketing & financial writing. Multimodal (reads charts/images). |
| **Phi-4 (14B)**    | Q8_0   | ~16GB | Above-weight structured reasoning/analysis; most VRAM left for context.              |

## Suggested first three to test

1. **Qwen2.5-Coder-32B** — artifacts & chart code
2. **Gemma-3-27B-it** — prose & analysis
3. **Qwen3-30B-A3B** — fast all-rounder

That trio covers every listed use case with VRAM headroom to spare.

## Workflow per model, after download

1. `npm run calibrate -- --model X` — measure real KV bytes/token, save to `config/profiles.json`.
2. For any **thinking** model (Qwen3 family, R1/QwQ distills): `npm run sweep -- --model X` to find the reasoning-budget cap before trusting it for documents/charts (otherwise it defaults to `-1` and can return zero content).
3. Keep the default `q8_0` KV + flash attention to stretch context without much quality loss.
