import { Worker } from "node:worker_threads";
import { z } from "zod";
import type { EditorSearchOptions } from "@getpaseo/plugin/otto/editor";

// User regexes run outside the daemon event loop. A pathological expression is
// terminated, not allowed to freeze every connected client. One worker per
// explicit search, serial files, with no subprocess or filesystem access.
const code = String.raw`
const { parentPort } = require("node:worker_threads");
parentPort.on("message", ({text,options,replacement}) => {
  try {
    const body = options.regexp ? options.query : options.query.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
    const pattern = options.wholeWord ? "(?<!\\w)(?:" + body + ")(?!\\w)" : body;
    const regex = new RegExp(pattern, options.caseSensitive ? "g" : "gi");
    const matches = [];
    let count = 0;
    const lines = text.split(/(\r\n|\r|\n)/);
    for (let i = 0; i < lines.length; i += 2) {
      const line = lines[i];
      if (line.length > 10000) continue;
      regex.lastIndex = 0;
      let hit;
      while ((hit = regex.exec(line)) !== null) {
        if (matches.length < 200) {
          const from = Math.max(0, hit.index - 60);
          matches.push({line: i / 2 + 1, column:hit.index + 1, length:hit[0].length, preview:line.slice(from,from + 240)});
        }
        count++;
        if (!hit[0].length) regex.lastIndex++;
      }
      if (replacement !== undefined) lines[i] = options.regexp ? line.replace(regex,replacement) : line.replace(regex,() => replacement);
    }
    parentPort.postMessage({matches,count,after:replacement === undefined ? null : lines.join("")});
  } catch (error) { parentPort.postMessage({error:error.message}); }
});`;
const Result = z.object({
  matches: z.array(
    z.object({ line: z.number(), column: z.number(), length: z.number(), preview: z.string() }),
  ),
  count: z.number(),
  after: z.string().nullable(),
});
export class SearchMatcher {
  private readonly worker = new Worker(code, { eval: true });
  // Node's MessagePort accepts a transfer list, never a browser target origin.
  private readonly send = this.worker.postMessage.bind(this.worker);
  async match(text: string, options: EditorSearchOptions, replacement?: string) {
    return new Promise<z.infer<typeof Result>>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.worker.removeListener("message", message);
        this.worker.removeListener("error", fail);
        this.worker.removeListener("exit", exited);
      };
      const fail = (error: Error) => {
        finish();
        reject(error);
      };
      const exited = () => fail(new Error("The search worker stopped."));
      const message = (value: unknown) => {
        finish();
        const parsed = Result.safeParse(value);
        if (parsed.success) resolve(parsed.data);
        else {
          const error = z.object({ error: z.string() }).safeParse(value);
          reject(new Error(error.success ? error.data.error : "Invalid search result."));
        }
      };
      const timer = setTimeout(() => {
        fail(new Error("The search expression exceeded its time limit. Simplify the pattern."));
        void this.worker.terminate();
      }, 1000);
      this.worker.once("message", message);
      this.worker.once("error", fail);
      this.worker.once("exit", exited);
      this.send({ text, options, replacement });
    });
  }
  close() {
    return this.worker.terminate();
  }
}
