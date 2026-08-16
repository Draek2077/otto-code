---
id: "finding-2026-08-04-cuda-vs-vulkan-and-cuda-asset-origins"
kind: "finding"
title: "Is a CUDA `llama-server` worth obtaining on Linux, and where would it come from?"
status: "confirmed"
tags: ["finding", "linux-gpu-acceleration"]
created_at: "2026-08-16T22:16:11.488Z"
updated_at: "2026-08-16T22:16:11.488Z"
---

# Is a CUDA `llama-server` worth obtaining on Linux, and where would it come from?

<!-- compiled_truth -->

**Date:** 2026-08-04
**Question:** `resolveRuntimeVariant` returns `vulkan` for a Linux machine with an NVIDIA GPU,
because upstream publishes no Linux CUDA release asset. Windows gets real CUDA. Is that gap costing
otto-brain measurable performance, and if so, which of the available CUDA origins should we take?

What gets done about this is a row in [`projects/README.md`](../../../projects/README.md). This file is
the evidence only.

## Verdict in one line

On this hardware CUDA and Vulkan are **within measurement error of each other** at every prefill
depth tested and at token generation, so neither of the two CUDA-origin designs pays for itself.
The investigation's durable output is not the benchmark: it is three corrected facts about the
upstream asset matrix, one of which is a live bug on the Linux path shipping today.

## Environment

|                 |                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| GPU             | NVIDIA GeForce RTX 5090 Laptop, 24462 MiB, compute capability 12.0 (Blackwell)                        |
| Driver          | 610.62                                                                                                |
| Power           | AC, "Turbo" plan, 130 W board cap, `clocks_throttle_reasons.active=0x4` (SW power cap) under load     |
| llama.cpp build | b10236 (`1464c62d8`), identical binary lineage on both backends                                       |
| Windows         | Windows 11 Home 10.0.26200, official `win-cuda-12.4-x64` + `cudart` and `win-vulkan-x64` release zips |
| Linux           | WSL2, Ubuntu 24.04, kernel 6.18.33.2-microsoft-standard-WSL2                                          |
| Models          | `Qwable-27b_Q4_K_M.gguf` (26.90 B, 15.40 GiB), `gemma-4-E4B-it-Q4_K_M.gguf` (7.52 B, 4.95 GiB)        |

Both backends were measured on **Windows** for the headline comparison. That is deliberate: WSL2
carries no NVIDIA Vulkan ICD (see below), so it cannot host a fair Vulkan run, and measuring CUDA on
Linux against Vulkan on Windows would confound backend with OS. Windows holds OS, driver, build,
tool, GPU and model fixed and varies only the backend.

## Method

Canonical `llama-bench` from the official release archives, same binary version on both sides:

```
llama-bench.exe -m <model> -p 512,2048,4096,8192 -n 128 -ngl 99 -r 8
```

`-r 8` matters. An initial pass at the default 5 repetitions produced standard deviations as wide as
±1797 t/s on a 5384 t/s mean, because the first repetitions run on cold clocks while the laptop GPU
ramps toward its power cap. Every conclusion below rests on the 8-repetition run, whose standard
deviations are one to two orders of magnitude tighter.

## Result 1: CUDA versus Vulkan, same OS, same build

`Qwable-27b Q4_K_M`, Windows, b10236, 8 repetitions:

| test   | CUDA t/s        | Vulkan t/s      | CUDA advantage |
| ------ | --------------- | --------------- | -------------- |
| pp512  | 1093.34 ± 51.36 | 1053.34 ± 38.78 | 1.04x          |
| pp2048 | 1121.04 ± 6.89  | 1117.78 ± 26.03 | 1.00x          |
| pp4096 | 1097.47 ± 15.17 | 1088.44 ± 26.21 | 1.01x          |
| pp8192 | 1098.56 ± 0.63  | 1075.88 ± 13.08 | 1.02x          |
| tg128  | 31.35 ± 0.36    | 31.22 ± 0.29    | 1.00x          |

At pp2048, pp4096 and tg128 the two backends differ by less than their own standard deviations. The
largest gap anywhere is 4% at pp512, the shallowest and noisiest depth.

**The prefill hypothesis is retired.** The expectation going in was that the gap would be widest on
prompt processing, since that is what an agentic coding workload hammers. It is not: prefill
throughput is flat at roughly 1100 t/s for both backends from 512 through 8192 tokens, and going
deeper does not separate them.

The reason is visible in the Vulkan backend's own device line:

```
ggml_vulkan: 0 = NVIDIA GeForce RTX 5090 Laptop GPU (NVIDIA) | matrix cores: NV_coopmat2
```

NVIDIA's Vulkan driver exposes `VK_NV_cooperative_matrix2`, and llama.cpp's Vulkan backend uses it,
so both paths reach the same tensor cores. The historical CUDA-versus-Vulkan gap is a statement
about older drivers and older ggml, not about this build.

A 5-repetition run at an earlier stage suggested 1.12x to 1.15x in CUDA's favour. That figure is
**noise, not signal**, and is recorded here only so it is not rediscovered and believed.

## Result 2: the three CUDA origins, costed

### Upstream publishes per-build CUDA images, contrary to the premise

The prior belief was that `server-cuda-b*` tags stop at b5343, making a per-build pin impossible and
forcing a digest pin decoupled from `DEFAULT_LLAMA_BUILD`. That is **wrong**, and the error is a
pagination artifact: `GET /v2/ggml-org/llama.cpp/tags/list?n=10000` returns exactly 1000 tags, and
the naive read of that page finds 86 CUDA tags topping out at b5343. Following the `Link` header
through all 11 pages returns 10287 tags, of which **484** match `server-cuda-b<n>`, spanning b4721
to b10257.

Release tags and container tags are published on different cadences (a release for nearly every
build, an image every 15 to 20), so they intersect on a subset:

| set                             | count      |
| ------------------------------- | ---------- |
| GitHub release tags             | 6781       |
| `server-cuda-b*` container tags | 484        |
| build numbers with **both**     | 376        |
| newest with both                | **b10236** |

So a container-sourced Linux CUDA runtime could have stayed version-pinned and aligned with every
other platform. b10236 publishes an asset-name set identical to the current b10265 pin, so moving
the pin would have been a no-op for Windows and macOS. This removes the reproducibility objection to
option A entirely. It is recorded because it was the load-bearing reason to prefer option B, and it
turned out not to be true.

### The dependency closure is where option A actually fails

The image's `/app` layer is well shaped for us: one flat directory holding `llama-server` and every
ggml shared object, which is exactly what `findFile` plus `dir = path.dirname(exe)` already expects.
It is only 165 MB. But `libggml-cuda.so` does not stand alone:

```
$ objdump -p libggml-cuda.so | grep NEEDED
  NEEDED  libcudart.so.12
  NEEDED  libcublas.so.12
  NEEDED  libcuda.so.1      <- host driver, satisfied from /usr/lib/wsl/lib
  NEEDED  libnccl.so.2
  NEEDED  libgomp.so.1
```

`libcuda.so.1` comes from the host driver. The rest have to be shipped, and they do not come from
one place:

| library                                 | origin                                                                                      | download |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| `libcudart.so.12`                       | NVIDIA CUDA redist                                                                          | 1.4 MB   |
| `libcublas.so.12` + `libcublasLt.so.12` | NVIDIA CUDA redist                                                                          | 938.7 MB |
| `libnccl.so.2`                          | **absent from the CUDA redist**; PyPI wheel `nvidia-nccl-cu12` or the image's 2058 MB layer | 201 MB   |
| `libgomp.so.1`                          | distro package, shipped by nobody (see Result 3)                                            | 0.1 MB   |

That is the finding that kills option A. Assembling a CUDA runtime means either **three origins**
(ghcr, NVIDIA's redist server, and PyPI) or a single-origin pull of the image's 2.0 GB CUDA-libraries
layer to extract three files from it. Neither is a small change to a module whose stated virtue is
extraction "using only OS built-ins".

Two further mechanical obstacles, both verified:

- **ghcr blobs require auth.** Anonymous `GET /v2/.../blobs/<digest>` returns **401**; it needs a
  bearer token from `ghcr.io/token?scope=repository:ggml-org/llama.cpp:pull`. `downloadFile` issues a
  bare `fetch(url)` with no header support.
- **Blob URLs carry no file extension.** `installManagedRuntime` derives the local filename from
  `path.basename(new URL(url).pathname)`, which yields `sha256:...`, and `extractArchive` dispatches
  on the extension, so it would throw `unknown archive type` on a layer that is in fact a gzipped tar.

### Footprint

|                                            | download | on disk    |
| ------------------------------------------ | -------- | ---------- |
| Linux Vulkan (`ubuntu-vulkan-x64`)         | 32 MB    | 90 MB      |
| Linux CUDA, assembled and verified working | ~1306 MB | **1.3 GB** |
| Windows CUDA (for reference)               | 641 MB   |            |

The CUDA runtime's bulk is not llama.cpp. It is `libcublasLt.so` at 717 MB, `libnccl.so.2` at
259 MB and `libggml-cuda.so` at 162 MB. So the ask is a 40x download and a 14x disk footprint to buy
between 0% and 4%.

### The extracted binary does work

Recorded because it was worth establishing regardless of the decision. Layers 10 and 11 of
`server-cuda-b10236` (amd64, digest `sha256:fcd0f95f...`), plus the four libraries above, run
outside the container against the host WSL driver:

```
$ LD_LIBRARY_PATH=$PWD ./llama-server --version
version: 10236 (1464c62d8)
$ LD_LIBRARY_PATH=$PWD ./llama-server --list-devices
CUDA0: NVIDIA GeForce RTX 5090 Laptop GPU (24462 MiB, 23119 MiB free)
```

Blackwell (sm_120) is covered, and the image config carries
`org.opencontainers.image.version: b10236` as an OCI label, so the build number is readable without
executing anything. Option A is technically feasible. It is just not worth it.

## Result 3: no upstream Linux asset ships `libgomp.so.1`

Found while resolving the CUDA dependency closure, and **not specific to CUDA**. On a stock Ubuntu
24.04 with no `libgomp1` installed, the current shipping Linux assets extract cleanly and then fail
to execute:

```
$ tar -xzf llama-b10236-bin-ubuntu-vulkan-x64.tar.gz
$ LD_LIBRARY_PATH=$PWD ./llama-server --version
./llama-server: error while loading shared libraries: libgomp.so.1:
    cannot open shared object file: No such file or directory
exit=127
```

Reproduced identically on `llama-b10236-bin-ubuntu-x64.tar.gz`. Neither archive contains a
`libgomp`. The asymmetry is upstream's: the Windows CUDA archive **does** bundle its OpenMP runtime
as `libomp140.x86_64.dll`, while no Linux archive bundles the GNU equivalent.

The user-visible failure is that `otto brain runtime install` reports success and the supervisor then
dies on spawn. `buildEnv` cannot help: `LD_LIBRARY_PATH` already points at the runtime directory, and
the library is not in it.

## Result 4: WSL2 has no NVIDIA Vulkan ICD

On this WSL2 install the Vulkan default resolves to no GPU at all:

```
$ ./llama-server --list-devices     # ubuntu-vulkan-x64
Available devices:
  (none)
```

`libvulkan.so.1` is present and `/usr/share/vulkan/icd.d/` holds seven Mesa ICDs (`nouveau`, `radeon`,
`intel`, `lvp`, ...), but no NVIDIA one, and `/usr/lib/wsl/lib` ships CUDA, D3D12 and NVENC libraries
with no Vulkan ICD among them. The CUDA build on the same machine sees the GPU immediately.

It does not fail loudly. The Vulkan backend loads, finds no device, and falls through to CPU, which
costs one to two orders of magnitude. Same model, same machine, same build:

| `gemma-4-E4B` on WSL2                    | pp2048 t/s       | tg t/s        |
| ---------------------------------------- | ---------------- | ------------- |
| Vulkan asset (the current Linux default) | 111.73 ± 17.71   | 15.02 ± 0.17  |
| CUDA, extracted from the container image | 4619.81 ± 210.88 | 74.93 ± 41.91 |
| ratio                                    | **41x**          | **5x**        |

This is the one result that favours a Linux CUDA runtime, and its scope is narrow. It is a property
of WSL2's GPU-PV passthrough, **not measured on native Linux**, where the proprietary NVIDIA driver
does install an ICD, and the population it hurts (someone running otto-brain inside WSL2 on a
Windows machine with an NVIDIA GPU) has a native Windows brain available with real CUDA already.

The harm here is the silence, not the missing asset: 41x slower with no diagnostic is worse than a
refusal. That argues for detecting the zero-device case and saying so, which is cheap, rather than
for a second asset origin, which is not.

## Limits of this measurement

- **One GPU, one architecture.** Blackwell with driver 610.62 and `NV_coopmat2`. On an NVIDIA GPU or
  driver without cooperative-matrix support the Vulkan backend loses its tensor-core path and the
  comparison could look very different. The parity result should not be generalised past hardware
  that reports `NV_coopmat2`.
- **Power-capped laptop part.** Sustained runs sat against a 130 W software power cap at roughly
  1100 t/s prefill. Both backends were capped identically, so the ratio is sound, but a desktop card
  with more thermal headroom might separate them.
- **Two models, one quantisation.** Q4_K_M at 7.5 B and 26.9 B.
- Absolute Linux CUDA numbers were taken under WSL2, which costs 10% to 30% against native Windows
  CUDA on the same GPU. They are not comparable to the Windows table above and were not used for the
  verdict, which rests entirely on the same-OS Windows comparison.

## Commands that reproduce this

```bash
# the tag intersection (the pagination trap is the point)
curl -s "https://ghcr.io/token?scope=repository:ggml-org/llama.cpp:pull&service=ghcr.io"
# then follow the Link header from /v2/ggml-org/llama.cpp/tags/list?n=1000 to exhaustion
gh api repos/ggml-org/llama.cpp/releases --paginate -q '.[].tag_name'

# the benchmark
llama-bench.exe -m <model> -p 512,2048,4096,8192 -n 128 -ngl 99 -r 8

# the libgomp failure, on a host without libgomp1
tar -xzf llama-b10236-bin-ubuntu-x64.tar.gz && LD_LIBRARY_PATH=$PWD ./llama-server --version
```

## Timeline

- time: "2026-08-16T22:16:11.488Z"
  kind: "migration"
  summary: "Migrated from the legacy findings report without discarding its evidence."
  source: "findings/linux-gpu-acceleration/2026-08-04-cuda-vs-vulkan-and-cuda-asset-origins.md"
