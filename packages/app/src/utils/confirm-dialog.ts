import { create } from "zustand";

export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  // When set, a checkbox with this label is rendered above the actions. Its
  // state is returned as `checkboxChecked` from `confirmDialogWithCheckbox`.
  checkboxLabel?: string;
  // Initial checked state for the checkbox (defaults to false). Lets a caller
  // pre-select the recommended choice, e.g. "delete the merged branch".
  checkboxDefaultChecked?: boolean;
  // "alert" drops the cancel action — one acknowledge button, nothing to
  // decide. Used by `alertDialog` for messages that only need to be seen.
  kind?: "confirm" | "alert";
}

export interface ConfirmDialogResult {
  confirmed: boolean;
  checkboxChecked: boolean;
}

export interface ConfirmDialogRequest extends ConfirmDialogInput {
  id: number;
  resolve: (result: ConfirmDialogResult) => void;
}

interface ConfirmDialogStoreState {
  // Requests are queued so overlapping confirmations resolve in order rather
  // than clobbering each other's promise resolvers.
  queue: ConfirmDialogRequest[];
  enqueue: (request: ConfirmDialogRequest) => void;
  resolveActive: (result: ConfirmDialogResult) => void;
}

let nextRequestId = 1;

export const useConfirmDialogStore = create<ConfirmDialogStoreState>((set, get) => ({
  queue: [],
  enqueue: (request) => set((state) => ({ queue: [...state.queue, request] })),
  resolveActive: (result) => {
    const [active, ...rest] = get().queue;
    if (!active) {
      return;
    }
    set({ queue: rest });
    active.resolve(result);
  },
}));

/**
 * Shows a themed in-app confirmation dialog (rendered by the globally-mounted
 * `ConfirmDialogHost`) and resolves with the user's choice plus the checkbox
 * state when {@link ConfirmDialogInput.checkboxLabel} is provided.
 */
export function confirmDialogWithCheckbox(input: ConfirmDialogInput): Promise<ConfirmDialogResult> {
  return new Promise<ConfirmDialogResult>((resolve) => {
    useConfirmDialogStore.getState().enqueue({ ...input, id: nextRequestId++, resolve });
  });
}

export async function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  const result = await confirmDialogWithCheckbox(input);
  return result.confirmed;
}

/**
 * Shows a message the user only has to acknowledge. Use this instead of
 * `Alert.alert` for anything the user must see: react-native-web's Alert is a
 * no-op, so an alert-only failure path is silent on web and Electron desktop.
 */
export async function alertDialog(
  input: Omit<ConfirmDialogInput, "kind" | "cancelLabel" | "checkboxLabel">,
): Promise<void> {
  await confirmDialogWithCheckbox({ ...input, kind: "alert" });
}
