import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { WorkflowError } from "./files.js";

const require = createRequire(import.meta.url);
const source = `
const {parentPort, workerData} = require('node:worker_threads');
const jsonata = require(workerData.module);
Promise.resolve().then(() => jsonata(workerData.expression).evaluate(JSON.parse(workerData.context)))
  .then(value => {
    const encoded = JSON.stringify(value);
    if (encoded !== undefined && Buffer.byteLength(encoded) > 1024*1024) throw new Error('Workflow expression output exceeds one MiB.');
    parentPort.postMessage({ok: true, value});
  }).catch(error => parentPort.postMessage({ok: false, message: String(error.message || 'Invalid expression').slice(0,1000)}));
`;
interface QueuedExpression {
  expression: string;
  context: string;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

/** No workers/timers until execution. A finite global budget protects the daemon, including ordinary chats. */
class ExpressionQueue {
  private active = 0;
  private readonly queue: QueuedExpression[] = [];
  evaluate(expression: string, context: unknown): Promise<unknown> {
    assertWorkflowExpression(expression);
    const encoded = JSON.stringify(context);
    if (encoded === undefined || Buffer.byteLength(encoded) > 1024 * 1024)
      return Promise.reject(
        new WorkflowError("invalid", "Workflow expression input exceeds its budget."),
      );
    if (this.queue.length >= 16)
      return Promise.reject(new WorkflowError("busy", "Workflow expression capacity is busy."));
    return new Promise((resolve, reject) => {
      this.queue.push({ expression, context: encoded, resolve, reject });
      this.drain();
    });
  }
  private drain(): void {
    while (this.active < 2 && this.queue.length) {
      const task = this.queue.shift();
      if (!task) return;
      this.active++;
      void evaluateInWorker(task)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
}
export function assertWorkflowExpression(expression: string): void {
  if (!expression.trim() || expression.length > 4096)
    throw new WorkflowError("invalid", "Workflow expressions must contain 1–4,096 characters.");
}
async function evaluateInWorker(task: QueuedExpression): Promise<unknown> {
  const worker = new Worker(source, {
    eval: true,
    execArgv: [],
    env: {},
    workerData: {
      expression: task.expression,
      context: task.context,
      module: require.resolve("jsonata"),
    },
    resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
  });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new WorkflowError(
              "invalid",
              "Workflow expression exceeded its one-second execution budget.",
            ),
          ),
        1000,
      );
      const cleanup = () => {
        clearTimeout(timer);
      };
      worker.once("message", (value: { ok: boolean; value?: unknown; message?: string }) => {
        cleanup();
        if (value.ok) resolve(value.value);
        else
          reject(
            new WorkflowError(
              "invalid",
              value.message?.slice(0, 1000) ?? "Invalid Workflow expression.",
            ),
          );
      });
      worker.once("error", (error) => {
        cleanup();
        reject(
          new WorkflowError("invalid", "Workflow expression worker failed.", { cause: error }),
        );
      });
      worker.once("exit", () => {
        cleanup();
        reject(new WorkflowError("invalid", "Workflow expression worker exited without a result."));
      });
    });
  } finally {
    await worker.terminate();
    worker.removeAllListeners();
  }
}
const expressions = new ExpressionQueue();
export function evaluateWorkflowExpression(expression: string, context: unknown): Promise<unknown> {
  return expressions.evaluate(expression, context);
}
