import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import type { PromptTemplate } from "@getpaseo/plugin/otto/workflows";
import { WorkflowSlots } from "./run-state.js";
import { WorkflowError } from "./files.js";
const require = createRequire(import.meta.url);
const slots = new WorkflowSlots(2);
let pending = 0;
const source = `
const {workerData,parentPort}=require('node:worker_threads');
const ejs=require(workerData.module);
const data=JSON.parse(workerData.data);
const templates=new Map(data.templates.map(template=>[template.id,template]));
function render(id,variables,depth){
 if(depth>5)throw new Error('Template includes nest more than 5 deep.');
 const template=templates.get(id);if(!template)throw new Error('Included template is not in the reviewed snapshot: '+id);
 const include=(next,locals)=>render(next,{...variables,...locals},depth+1);
 const value=ejs.render(template.content,{...variables,include},{escape:value=>value==null?'':String(value),cache:false,filename:undefined});
 if(value.length>64000)throw new Error('Rendered template exceeds 64,000 characters.');
 return value;
}
Promise.resolve().then(()=>{
 if(data.validateOnly){for(const template of data.templates)ejs.compile(template.content,{cache:false,filename:undefined});return 'validated';}
 return render(data.id,data.variables,0);
}).then(value=>parentPort.postMessage({ok:true,value}),error=>parentPort.postMessage({ok:false,message:String(error.message).slice(0,1000)}));
`;
/** Explicitly trusted EJS is code execution, never an import side effect or a claimed filesystem sandbox. */
export async function renderReviewedEjs(
  id: string,
  templates: PromptTemplate[],
  variables: Record<string, unknown>,
  signal: AbortSignal,
  validateOnly = false,
): Promise<string> {
  const data = JSON.stringify({ id, templates, variables, validateOnly });
  if (Buffer.byteLength(data) > 1024 * 1024)
    throw new WorkflowError("invalid", "Template snapshot exceeds its execution budget.");
  if (pending >= 16) throw new WorkflowError("busy", "Workflow template capacity is busy.");
  pending++;
  let release: (() => void) | null = null;
  try {
    release = await slots.acquire(signal);
    const worker = new Worker(source, {
      eval: true,
      execArgv: [],
      env: {},
      workerData: { module: require.resolve("ejs"), data },
      resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    let abort: (() => void) | null = null;
    try {
      return await new Promise<string>((resolve, reject) => {
        abort = () => reject(signal.reason ?? new Error("Template rendering canceled."));
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(
          () =>
            reject(
              new WorkflowError(
                "invalid",
                "Workflow template exceeded its one-second execution budget.",
              ),
            ),
          1000,
        );
        worker.once("message", (value: { ok: boolean; value?: string; message?: string }) => {
          if (value.ok && typeof value.value === "string" && value.value.length <= 64000)
            resolve(value.value);
          else
            reject(
              new WorkflowError(
                "invalid",
                value.message ?? "Workflow template returned invalid output.",
              ),
            );
        });
        worker.once("error", (error) =>
          reject(
            new WorkflowError("invalid", "Workflow template worker failed.", { cause: error }),
          ),
        );
        worker.once("exit", () =>
          reject(new WorkflowError("invalid", "Workflow template worker exited without a result.")),
        );
        if (signal.aborted) abort();
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) signal.removeEventListener("abort", abort);
      await worker.terminate();
      worker.removeAllListeners();
    }
  } finally {
    release?.();
    pending--;
  }
}
