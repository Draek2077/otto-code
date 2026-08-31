// @ts-nocheck
import { vi } from "vitest";
import React from "react";

const globalWithTestShims = globalThis as typeof globalThis & Record<string, unknown>;

globalWithTestShims.__DEV__ = false;

if (typeof globalThis.self === "undefined") {
  globalWithTestShims.self = globalThis;
}

if (typeof globalThis.expo === "undefined") {
  class ExpoEventEmitter {
    addListener() {
      return {
        remove() {},
      };
    }
    removeListener() {}
    removeAllListeners() {}
    emit() {}
    listenerCount() {
      return 0;
    }
  }

  class ExpoSharedObject extends ExpoEventEmitter {}
  class ExpoSharedRef extends ExpoSharedObject {}
  class ExpoNativeModule extends ExpoEventEmitter {}

  globalWithTestShims.expo = {
    EventEmitter: ExpoEventEmitter,
    SharedObject: ExpoSharedObject,
    SharedRef: ExpoSharedRef,
    NativeModule: ExpoNativeModule,
    modules: {},
  };
}

if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0) as unknown as number;
}

if (typeof globalThis.cancelAnimationFrame !== "function") {
  globalThis.cancelAnimationFrame = (handle: number) => {
    clearTimeout(handle);
  };
}

// jsdom does not implement matchMedia, and react-native-reanimated calls it at module load
// (`ReducedMotion.ts`) - so any jsdom test whose graph reaches reanimated throws before its
// first assertion. Reporting "no match" is right for a headless run: no reduced-motion
// preference, no media query satisfied.
if (
  typeof globalThis.window !== "undefined" &&
  typeof globalThis.window.matchMedia !== "function"
) {
  globalThis.window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// This mock wins over the `react-native-unistyles` alias in vitest.config.ts for
// every file that loads this setup, so it has to be at least as capable as the
// stub that alias points at. It borrows `StyleSheet` from that stub rather than
// keeping a second copy: `StyleSheet.create` takes a theme factory as often as a
// plain object, and a passthrough `create` hands the factory itself back, so
// `styles.someName.color` reads off a function and throws
// "Cannot read properties of undefined".
vi.mock("react-native-unistyles", async () => {
  const stub = await import("./test-stubs/react-native-unistyles");
  return {
    StyleSheet: stub.StyleSheet,
    // Delegated, not redefined: this used to answer `theme: {}`, so any
    // component grandfathered onto `useUnistyles` crashed on `theme.colors.*`
    // inside the test instead of failing an assertion. The stub serves the same
    // theme `StyleSheet.create` does, and it is deliberately built from
    // `theme-palettes` - importing the real theme here deadlocks, because it
    // reaches `@/constants/layout`, which imports this very module.
    useUnistyles: stub.useUnistyles,
    UnistylesRuntime: {
      setTheme: vi.fn(),
      themeName: "light",
    },
    // Wraps a leaf component so it can read theme values (see docs/unistyles.md - it wraps
    // leaves, never composites). The real one returns an equivalent component; passing the
    // component straight through is enough for tests, which assert behaviour rather than theming.
    withUnistyles: <T>(Component: T) => Component,
  };
});

// `@gorhom/bottom-sheet` resolves to sources that reach React Native internals no node test
// environment can parse, so importing it throws `SyntaxError: Unexpected token 'typeof'`. The
// throw is reported against whichever test file heads the import chain, which is why it showed
// up as an unexplained failure in composer and keyboard tests that never mention bottom sheets.
// Two tests already carried their own copy of this mock for exactly that reason
// (isolated-bottom-sheet-modal, tooltip); a local `vi.mock` still wins over this one.
vi.mock("@gorhom/bottom-sheet", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children);
  return {
    __esModule: true,
    default: Passthrough,
    BottomSheetModalProvider: Passthrough,
    BottomSheetModal: React.forwardRef((props: { children?: React.ReactNode }, _ref) =>
      React.createElement("div", null, props.children),
    ),
    BottomSheetBackdrop: () => null,
    BottomSheetScrollView: Passthrough,
    BottomSheetTextInput: () => null,
    BottomSheetView: Passthrough,
    useBottomSheetModalInternal: () => ({}),
  };
});

vi.mock("@gorhom/portal", () => ({
  Portal: ({ children, hostName }: { children?: React.ReactNode; hostName?: string }) =>
    React.createElement("div", { "data-portal-host": hostName }, children),
  PortalHost: ({ name }: { name?: string }) => React.createElement("div", { "data-host": name }),
  PortalProvider: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@xterm/addon-ligatures", () => ({
  LigaturesAddon: class LigaturesAddon {
    dispose(): void {}
  },
}));

vi.mock("react-native-svg", () => {
  const Stub = () => null;
  return {
    __esModule: true,
    default: Stub,
    Circle: Stub,
    Defs: Stub,
    G: Stub,
    Line: Stub,
    LinearGradient: Stub,
    Path: Stub,
    Rect: Stub,
    Stop: Stub,
    SvgCss: Stub,
    SvgCssUri: Stub,
    SvgFromXml: Stub,
    SvgUri: Stub,
    SvgXml: Stub,
    Use: Stub,
  };
});

vi.mock("expo-linking", () => ({
  openURL: vi.fn().mockResolvedValue(undefined),
}));

const RouterPassthrough = ({ children }: { children?: React.ReactNode }) => children;

vi.mock("expo-router", () => ({
  Redirect: () => null,
  Stack: Object.assign(RouterPassthrough, {
    Screen: () => null,
    Protected: RouterPassthrough,
  }),
  router: {
    back: vi.fn(),
    canGoBack: vi.fn(() => false),
    navigate: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    setParams: vi.fn(),
  },
  useGlobalSearchParams: vi.fn(() => ({})),
  useLocalSearchParams: vi.fn(() => ({})),
  usePathname: vi.fn(() => "/"),
  useRootNavigationState: vi.fn(() => ({ key: "root" })),
  useRouter: vi.fn(() => ({
    back: vi.fn(),
    canGoBack: vi.fn(() => false),
    navigate: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    setParams: vi.fn(),
  })),
}));
