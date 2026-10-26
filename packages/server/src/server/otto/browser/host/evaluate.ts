import { z } from "zod";
export const HostEvaluationSchema = z.object({
  resultJson: z.string().max(80_000),
  truncated: z.boolean(),
});
/** The cap is applied inside the page, before an arbitrary result crosses the CDP boundary. */
export function hostEvaluation(source: string, element: string | null): string {
  return `(async () => {
    const candidate = (${source});
    const value = await (typeof candidate === 'function' ? candidate(${element ?? "undefined"}) : candidate);
    const text = JSON.stringify(value) ?? 'null';
    return text.length <= 80000 ? {resultJson:text,truncated:false} : {resultJson:JSON.stringify(text.slice(0,39000)),truncated:true};
  })()`;
}
