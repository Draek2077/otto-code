import { memo } from "react";
import {
  StatusRingFrame,
  type StatusRingProps,
  ThemedStatusBlobLoader,
} from "@/components/status-ring/frame";
import { STATUS_RING_FRAME_SIZE } from "@/components/status-ring/geometry";

/**
 * Web running indicator. BlobLoader shares one browser-timeline animation across every instance.
 */
export const StatusRing = memo(function StatusRing({ backdrop, centerStyle }: StatusRingProps) {
  return (
    <StatusRingFrame backdrop={backdrop} centerStyle={centerStyle}>
      <ThemedStatusBlobLoader size={STATUS_RING_FRAME_SIZE} />
    </StatusRingFrame>
  );
});
