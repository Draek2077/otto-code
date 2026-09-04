// Browser-project stand-in for expo-router. Its build output carries JSX in
// plain `.js` files, which Vite's dependency optimizer cannot parse, so any
// browser test whose import graph reaches the router aborted the optimizer
// mid-run. Browser tests exercise components, never navigation, so the router
// surface is inert here.
import type { ReactNode } from "react";

type Params = Record<string, string | string[] | undefined>;

const noop = () => {};

export type Href = string | { pathname: string; params?: Params };

export const router = {
  push: noop,
  replace: noop,
  back: noop,
  navigate: noop,
  dismiss: noop,
  dismissAll: noop,
  canGoBack: () => false,
  setParams: noop,
};

export function useRouter() {
  return router;
}

export function useLocalSearchParams<T extends Params = Params>(): T {
  return {} as T;
}

export function useGlobalSearchParams<T extends Params = Params>(): T {
  return {} as T;
}

export function usePathname(): string {
  return "/";
}

export function useSegments(): string[] {
  return [];
}

export function useRootNavigationState() {
  return { key: "stub", stale: false, routes: [], index: 0 };
}

export function useNavigationContainerRef() {
  return { current: null, isReady: () => false, navigate: noop, goBack: noop };
}

export function Redirect(_props: { href: Href }): null {
  return null;
}

export function Link(props: { children?: ReactNode }): ReactNode {
  return props.children ?? null;
}

function StackComponent(props: { children?: ReactNode }): ReactNode {
  return props.children ?? null;
}
StackComponent.Screen = (): null => null;
export const Stack = StackComponent;

export function Slot(): null {
  return null;
}
