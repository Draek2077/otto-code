/**
 * Test stub for `react-native-safe-area-context`.
 *
 * The real package's entry pulls in `NativeSafeAreaProvider`, which imports
 * `react-native/Libraries/Utilities/codegenNativeComponent` - a Flow-typed `.js` file in React
 * Native's codegen path. Nothing in a node test environment can parse it, so the import throws
 * `SyntaxError: Unexpected token 'typeof'` and takes down whichever test file happens to sit at
 * the top of the chain (`keyboard-action-dispatcher.test.ts` and `input-draft.live.test.tsx`
 * were the visible casualties, neither of which knows this package exists).
 *
 * The app only ever uses these two exports, and both are chrome-level: insets are zero in a node
 * environment because there is no device, and the provider is a pass-through. Stubbing here keeps
 * the failure from being re-diagnosed every time a new test transitively imports the toast host.
 */
import type { ReactNode } from "react";

export interface EdgeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ZERO_INSETS: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

export function useSafeAreaInsets(): EdgeInsets {
  return ZERO_INSETS;
}

export function SafeAreaProvider({ children }: { children?: ReactNode }): ReactNode {
  return children ?? null;
}
