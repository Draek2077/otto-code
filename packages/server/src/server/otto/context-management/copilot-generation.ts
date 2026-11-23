import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import type { ProviderRuntimeSettings } from "../../agent/provider-launch-config.js";
import {
  createProviderEnvSpec,
  resolveProviderLaunch,
} from "../../agent/provider-launch-config.js";
import { spawnProcess } from "../../../utils/spawn.js";
import { terminateWithTreeKill } from "../../../utils/tree-kill.js";
import {
  runCopilotGeneration,
  type CopilotGenerationInput,
} from "./copilot-generation-protocol.js";

/** Reuse the configured native CLI/auth; do not install a second SDK-bundled Copilot executable. */
export async function generateCopilotContextText(
  input: CopilotGenerationInput,
  runtimeSettings?: ProviderRuntimeSettings,
): Promise<string> {
  const launch = await resolveProviderLaunch({
    defaultBinary: "copilot",
    commandConfig: runtimeSettings?.command,
  });
  input.signal.throwIfAborted();
  const child = spawnProcess(
    launch.command,
    [...launch.args, "--headless", "--no-auto-update", "--stdio", "--log-level", "error"],
    {
      cwd: input.cwd,
      ...createProviderEnvSpec({ runtimeSettings }),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (!child.stdout || !child.stdin) throw new Error("Copilot utility requires stdio.");
  child.stderr?.resume(); // Provider diagnostics may contain private data; never surface or retain them here.
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );
  const lifetime = new AbortController();
  const signal = AbortSignal.any([input.signal, lifetime.signal]);
  const abort = () => connection.dispose();
  const failed = () => lifetime.abort();
  signal.addEventListener("abort", abort, { once: true });
  child.once("error", failed);
  child.once("exit", failed);
  connection.listen();
  try {
    return await runCopilotGeneration(
      {
        request: (method, params) => connection.sendRequest(method, params),
        notifications: (listener) => {
          const subscription = connection.onNotification("session.event", listener);
          return () => subscription.dispose();
        },
        requests: (listener) => {
          const subscription = connection.onRequest(listener);
          return () => subscription.dispose();
        },
      },
      { ...input, signal },
    );
  } finally {
    signal.removeEventListener("abort", abort);
    connection.dispose();
    child.removeListener("error", failed);
    child.removeListener("exit", failed);
    await terminateWithTreeKill(child, { gracefulTimeoutMs: 1000, forceTimeoutMs: 1000 });
  }
}
