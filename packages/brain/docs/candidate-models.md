# Candidate models to download

Curated shortlist for **12-32GB-VRAM home hardware**, aimed at **coding +
generative** work: producing logic, financial/marketing prose and analysis,
creating documents, and generating charts/graphs via code (widgets, artifacts).

**One canonical entry per distinct model** (dense _and_ MoE both). Quant, imatrix,
distill, MTP and other re-quant **variants are intentionally excluded** - the base
list stays clean; search Hugging Face directly when you want a specific spin.

Source of truth is [`config/downloads.json`](../config/downloads.json) - edit
that, then keep this table in sync. `~VRAM` is the on-disk GGUF weight size at
the listed quant (approximate); **real KV/context fit must still be measured**
with `npm run calibrate -- --model X`, because the theoretical KV formula
overestimates badly. Repos/files verified against public GGUF releases as of
2026-07 - confirm the exact file before downloading.

Target: keep weights ≈ 12–26GB so headroom stays free for KV cache + context.

## Bundle companions

Vision-capable rows below are bundles. Their text model remains the required
download; image understanding is an optional projector that can be downloaded
and loaded independently. Muse Glimmer also offers an optional faster-drafting
component. The Brain Library labels these by what they enable rather than by
their GGUF filenames.

| Model                 | Optional components                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Qwen3.6 27B           | Image understanding (`mmproj-F16.gguf`)                                                           |
| Muse Glimmer 30B      | Image understanding (`mmproj-Muse-Glimmer-30B-Q8_0.gguf`), faster drafting (`dflash-kquant.gguf`) |
| Gemma 3 27B           | Image understanding (`mmproj-model-f16.gguf`)                                                     |
| Gemma 4 31B           | Image understanding (`mmproj-gemma-4-31B-it-BF16.gguf`)                                           |
| Mistral Small 3.2 24B | Image understanding (`mmproj-mistralai_Mistral-Small-3.2-24B-Instruct-2506-bf16.gguf`)            |
| Ornith 1.0 35B        | Image understanding (`mmproj-deepreinforce-ai_Ornith-1.0-35B-bf16.gguf`)                          |
| DeepSeek OCR 2        | Document understanding (`mmproj-deepseek-ocr-2-q8_0.gguf`)                                        |

## All-rounders (coding + prose + analysis)

| Model                                    | Quant      | ~VRAM | Notes                                                                                                      |
| ---------------------------------------- | ---------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| **Qwen3.6 27B**                          | Q5_K_M     | ~19GB | Vision-capable all-rounder for code, reasoning, writing, and image-aware tasks.                            |
| **Muse Glimmer 30B**                     | UD-Q4_K_XL | ~15GB | Vision-capable agentic model for coding, tool use, multi-step reasoning, and recovery from failed actions. |
| **Qwen3 32B**                            | Q5_K_M     | ~23GB | Thoughtful generalist for reasoning, programming, structured writing, and analysis.                        |
| **Qwen3 30B A3B** (MoE)                  | Q5_K_M     | ~22GB | Responsive all-purpose choice for everyday programming, reasoning, writing, and analysis.                  |
| **GLM-4.7 Flash** (MoE)                  | Q4_K_M     | ~17GB | Fast all-rounder for coding, reasoning, tool use, and interactive artifacts.                               |
| **NVIDIA Nemotron 3 Nano 30B A3B** (MoE) | Q4_K_M     | ~23GB | Reasoning-focused choice for analysis, long inputs, and tool use.                                          |
| **gpt-oss 20B** (MoE)                    | MXFP4      | ~11GB | Compact open-weight model with reliable tool calls, coding ability, and structured output.                 |
| **Ornith 1.0 35B** (MoE)                 | Q4_K_S     | ~19GB | Vision-capable all-rounder for complex tasks that mix text, code, and images.                              |
| **Mistral Small 3.2 24B**                | Q6_K       | ~19GB | Fast instruction follower for documents, structured data, and code.                                        |

## Coding & artifact/widget specialists

| Model                         | Quant  | ~VRAM | Notes                                                                                       |
| ----------------------------- | ------ | ----- | ------------------------------------------------------------------------------------------- |
| **Qwen 2.5 Coder 32B**        | Q4_K_M | ~20GB | Capable coding model for applications, self-contained HTML and React artifacts, and charts. |
| **Qwen3 Coder 30B A3B** (MoE) | Q5_K_M | ~21GB | Fast coding-focused model for tools, widgets, and iterative UI work.                        |
| **GLM-4 32B**                 | Q4_K_M | ~20GB | Coding specialist for single-file web apps, interactive widgets, and front-end prototypes.  |
| **Codestral 22B**             | Q6_K   | ~18GB | Fast fill-in-the-middle model for editor-style code completion and targeted edits.          |

## Prose / analysis leaning

| Model           | Quant  | ~VRAM | Notes                                                                            |
| --------------- | ------ | ----- | -------------------------------------------------------------------------------- |
| **Gemma 4 31B** | Q4_K_M | ~17GB | Vision-capable choice for polished prose, document analysis, and reading images. |
| **Gemma 3 27B** | Q4_K_M | ~17GB | Strong choice for marketing and financial writing, analysis, and document work.  |
| **Phi-4 14B**   | Q8_0   | ~16GB | Compact model with strong structured reasoning and analysis for its size.        |

## Document ingestion companion

| Model              | Quant | ~VRAM | Notes                                                                           |
| ------------------ | ----- | ----- | ------------------------------------------------------------------------------- |
| **DeepSeek OCR 2** | Q8_0  | ~3GB  | Compact vision model for extracting text and structure from documents and PDFs. |

## Suggested first three to test

1. **Muse Glimmer 30B** for vision-capable coding and local agent workflows
2. **Qwen3.6 27B** for vision-capable general work
3. **GLM-4.7 Flash** for fast coding and tool use

## Workflow per model, after download

1. `npm run calibrate -- --model X` - measure real KV bytes/token, save to `config/profiles.json`.
2. For any **thinking** model (Qwen3 family, GLM-4.7-Flash, Nemotron, gpt-oss, Ornith): `npm run sweep -- --model X` to find the reasoning-budget cap before trusting it for documents/charts (otherwise it defaults to `-1` and can return zero content).
3. Keep the default `q8_0` KV + flash attention to stretch context without much quality loss.
