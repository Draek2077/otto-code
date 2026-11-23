import { useEffect, useState, useSyncExternalStore } from "react";
import { WorkflowAction } from "./action";
export function useWorkflowAction(active: boolean) {
  const [model] = useState(() => new WorkflowAction());
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    if (active) return model.activate();
  }, [active, model]);
  return { model, state };
}
