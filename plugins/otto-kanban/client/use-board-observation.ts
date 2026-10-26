import { useEffect, useRef, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { releaseBoardChanges, waitBoardChanges } from "../shared/rpc.js";
import { newBoardOperationId } from "./action-form.js";
import { observeBoard } from "./board-observation.js";

export function useBoardObservation(input: {
  active: boolean;
  hostId: string;
  projectId: string;
  retry: number;
  changed(): void;
}) {
  const wait = useRpc(waitBoardChanges);
  const release = useRpc(releaseBoardChanges);
  const [failed, setFailed] = useState(false);
  const { active, hostId, projectId, retry, changed } = input;
  const onChanged = useRef(changed);
  useEffect(() => {
    onChanged.current = changed;
  }, [changed]);
  useEffect(() => {
    if (!active) return;
    setFailed(false);
    return observeBoard({
      binding: { hostId, projectId },
      leaseId: newBoardOperationId(),
      wait,
      release,
      changed: () => onChanged.current(),
      failed: () => setFailed(true),
    });
  }, [active, hostId, projectId, retry, wait, release]);
  return failed;
}
