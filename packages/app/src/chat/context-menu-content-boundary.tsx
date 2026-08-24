import { Component, type ErrorInfo, type ReactNode } from "react";
import { formatCaughtValue } from "@/components/root-error-details";

interface ChatContextMenuContentBoundaryProps {
  children: ReactNode;
  // Bumped every time the menu is opened with new content, so a caught error
  // belongs to that one menu and the next right click renders from scratch.
  resetKey: number;
  onError: () => void;
}

interface ChatContextMenuContentBoundaryState {
  hasError: boolean;
  resetKey: number;
}

/**
 * Contains a render failure in menu content contributed by a transcript
 * element.
 *
 * Contributed content is *created* inside the transcript but *rendered* in the
 * chat's menu surface, which is a sibling of the transcript. Anything the
 * content reads from a transcript-scoped React context is therefore absent,
 * and a context hook that throws on a missing provider escapes to the root
 * boundary: one right click blanks the whole app. Contributors should not
 * depend on transcript context at all (see `link-context-menu.tsx`), and this
 * boundary makes the failure mode of getting that wrong a menu that does not
 * open rather than an app that has to be reloaded.
 */
export class ChatContextMenuContentBoundary extends Component<
  ChatContextMenuContentBoundaryProps,
  ChatContextMenuContentBoundaryState
> {
  constructor(props: ChatContextMenuContentBoundaryProps) {
    super(props);
    this.state = { hasError: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(): Partial<ChatContextMenuContentBoundaryState> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(
    props: ChatContextMenuContentBoundaryProps,
    state: ChatContextMenuContentBoundaryState,
  ): ChatContextMenuContentBoundaryState | null {
    return props.resetKey === state.resetKey ? null : { hasError: false, resetKey: props.resetKey };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("[ChatContextMenuContentBoundary] Context menu content render error", {
      error: formatCaughtValue(error),
      componentStack: errorInfo.componentStack,
    });
    this.props.onError();
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}
