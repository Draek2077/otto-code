import { memo } from "react";
import {
  StatusRingFrame,
  type StatusRingProps,
  ThemedStatusBlobLoader,
  useStatusRingFrameSize,
} from "@/components/status-ring/frame";

/**
 * Web running indicator. BlobLoader shares one browser-timeline animation across every instance.
 */
export const StatusRing = memo(function StatusRing({ backdrop, centerStyle }: StatusRingProps) {
  const frameSize = useStatusRingFrameSize();
  return (
    <StatusRingFrame backdrop={backdrop} centerStyle={centerStyle}>
      <ThemedStatusBlobLoader size={frameSize} />
    </StatusRingFrame>
  );
});
