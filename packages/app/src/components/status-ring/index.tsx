import { memo } from "react";
import {
  StatusRingFrame,
  type StatusRingProps,
  ThemedStatusBlobLoader,
} from "@/components/status-ring/frame";
import { STATUS_RING_FRAME_SIZE } from "@/components/status-ring/geometry";

/**
 * Native running indicator. BlobLoader shares its own app-wide clock, so instances stay in phase
 * without giving the status row a per-instance timer.
 */
export const StatusRing = memo(function StatusRing({ backdrop, centerStyle }: StatusRingProps) {
  return (
    <StatusRingFrame backdrop={backdrop} centerStyle={centerStyle}>
      <ThemedStatusBlobLoader size={STATUS_RING_FRAME_SIZE} />
    </StatusRingFrame>
  );
});
