import type { AgentProviderNotice } from "@otto-code/protocol/agent-types";
import type { ToastApi } from "@/components/toast-host";

export function showProviderNoticeToast(
  toast: ToastApi,
  notice: AgentProviderNotice | null | undefined,
): void {
  if (!notice) {
    return;
  }
  if (notice.type === "error") {
    toast.error(notice.message);
    return;
  }
  toast.show(notice.message, {
    // ToastVariant has no info/warning tier; both render on the default surface,
    // with warnings held longer.
    variant: "default",
    durationMs: notice.type === "warning" ? 5000 : undefined,
  });
}
