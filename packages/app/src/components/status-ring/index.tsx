import { memo } from "react";
import {
  StatusRingFrame,
  type StatusRingProps,
  ThemedStatusBlobLoader,
  useStatusRingFrameSize,
} from "@/components/status-ring/frame";

/**
 * Native running indicator. BlobLoader shares its own app-wide clock, so instances stay in phase
 * without giving the status row a per-instance timer.
 */
export const StatusRing = memo(function StatusRing({ backdrop, centerStyle }: StatusRingProps) {
  const frameSize = useStatusRingFrameSize();
  return (
    <StatusRingFrame backdrop={backdrop} centerStyle={centerStyle}>
      <ThemedStatusBlobLoader size={frameSize} />
    </StatusRingFrame>
  );
});
