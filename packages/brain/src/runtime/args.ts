/**
 * Translates a profile into llama-server arguments and builds the PATH the child
 * needs. Runtime-source agnostic: works the same for an LM Studio runtime or a
 * managed one, since both resolve to a `Runtime` (exe + optional vendorDir).
 */
import type { Profile } from "../config/schema.js";
import type { Model, Runtime } from "../types.js";

export interface ServeTarget {
  port: number;
  host?: string;
}

/**
 * Loader environment the child process needs so it can resolve its shared
 * libraries. Both the runtime dir and its vendor dir go first, ahead of the
 * inherited values.
 *
 * PATH is the Windows half of this (the DLL-stub trap). The other two platforms
 * do not read PATH for libraries at all: a llama.cpp tarball puts
 * `libggml*.so`/`libllama.so` (or the `.dylib` equivalents) next to the binary,
 * so Linux needs LD_LIBRARY_PATH and macOS needs DYLD_LIBRARY_PATH or the
 * binary dies at load with an unresolved-library error before it prints a line.
 * PATH is still set everywhere - harmless, and it keeps the shape uniform.
 */
export function buildEnv(
  runtime: Runtime,
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const parts = [runtime.dir];
  if (runtime.vendorDir) parts.push(runtime.vendorDir);
  const delimiter = platform === "win32" ? ";" : ":";
  const prepend = (existing: string | undefined): string =>
    `${parts.join(delimiter)}${delimiter}${existing || ""}`;

  const env: NodeJS.ProcessEnv = { ...baseEnv, PATH: prepend(baseEnv.PATH) };
  if (platform === "darwin") env.DYLD_LIBRARY_PATH = prepend(baseEnv.DYLD_LIBRARY_PATH);
  else if (platform !== "win32") env.LD_LIBRARY_PATH = prepend(baseEnv.LD_LIBRARY_PATH);
  return env;
}

/**
 * Translate a profile into llama-server arguments.
 *
 * Only settings that demonstrably matter for stable local inference are emitted -
 * no experimental sampler knobs.
 */
export function buildArgs(
  profile: Profile,
  { port, host = "127.0.0.1" }: ServeTarget,
  model?: Model,
): string[] {
  const args: string[] = [
    "-m",
    profile.modelPath ?? "",
    "-c",
    String(profile.contextSize),
    "-ctk",
    profile.cacheTypeK,
    "-ctv",
    profile.cacheTypeV,
    "-fa",
    profile.flashAttention ? "on" : "off",
    "-ngl",
    String(profile.gpuLayers),
    "--host",
    host,
    "--port",
    String(port),
    "--no-webui",
  ];

  if (profile.vision && profile.mmprojPath) {
    args.push("--mmproj", profile.mmprojPath);
  }

  // Component paths were resolved by the host from the catalog manifest. Only
  // the known llama.cpp role is emitted; clients never supply process paths.
  const drafter = profile.componentPaths?.speculative_drafter;
  if (drafter) args.push("--model-draft", drafter);

  // The setting that was actually breaking long agentic runs.
  if (profile.reasoningBudget !== null && profile.reasoningBudget !== undefined) {
    args.push("--reasoning-budget", String(profile.reasoningBudget));
    if (profile.reasoningBudgetMessage) {
      args.push("--reasoning-budget-message", profile.reasoningBudgetMessage);
    }
  }

  if (profile.parallelSlots) args.push("--parallel", String(profile.parallelSlots));
  if (profile.contextMultiplier > 1) {
    const nativeContext = model?.metadata?.contextLength;
    args.push(
      "--rope-scaling",
      "yarn",
      "--rope-scale",
      String(profile.contextMultiplier),
      ...(nativeContext ? ["--yarn-orig-ctx", String(nativeContext)] : []),
      ...(model?.metadata?.arch
        ? ["--override-kv", `${model.metadata.arch}.context_length=int:${profile.contextSize}`]
        : []),
    );
  }
  if (profile.batchSize) args.push("-b", String(profile.batchSize));
  if (profile.ubatchSize) args.push("-ub", String(profile.ubatchSize));
  if (profile.chatTemplateFile) {
    args.push("--chat-template-file", profile.chatTemplateFile);
  }
  const templateKwargs = { ...profile.chatTemplateKwargs };
  const preservation = model?.reasoningPreservation;
  if (preservation?.templateArgument) {
    templateKwargs[preservation.templateArgument] =
      profile.preserveReasoning ?? preservation.default ?? false;
  }
  if (Object.keys(templateKwargs).length > 0) {
    args.push("--chat-template-kwargs", JSON.stringify(templateKwargs));
  }
  if (profile.extraArgs && profile.extraArgs.length) args.push(...profile.extraArgs);

  return args;
}

/** The same command as a copy-pasteable shell line, for the TUI to display. */
export function formatCommand(runtime: Runtime, args: string[]): string {
  const quote = (s: string): string => (/\s/.test(s) ? `"${s}"` : s);
  return `${quote(runtime.exe)} ${args.map(quote).join(" ")}`;
}
