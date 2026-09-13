/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddHostMethodModal } from "./add-host-method-modal";
const platform = vi.hoisted(() => ({ electron: false, native: false, fdroid: false }));
vi.mock("@/desktop/host", () => ({ isElectronRuntime: () => platform.electron }));
vi.mock("@/constants/platform", () => ({
  get isNative() {
    return platform.native;
  },
}));
vi.mock("@/constants/build-profile", () => ({
  get isFdroidBuild() {
    return platform.fdroid;
  },
}));
vi.mock("react-native", () => ({
  View: "div",
  Text: "span",
  Pressable: ({
    onPress,
    testID,
    children,
  }: {
    onPress(): void;
    testID?: string;
    children: React.ReactNode;
  }) => (
    <button type="button" onClick={onPress} data-testid={testID}>
      {children}
    </button>
  ),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/icons/material-icons", () => ({
  QrCode: () => null,
  Link2: () => null,
  ClipboardPaste: () => null,
  Terminal: () => null,
}));
vi.mock("./adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
afterEach(() => {
  cleanup();
  platform.electron = false;
  platform.native = false;
  platform.fdroid = false;
});
const handlers = () => ({
  visible: true,
  onClose: vi.fn(),
  onDirectConnection: vi.fn(),
  onRemoteSsh: vi.fn(),
  onScanQr: vi.fn(),
  onPasteLink: vi.fn(),
});
describe("connection method platform boundaries", () => {
  it("adds SSH only on Electron while preserving direct and pairing-link callbacks", () => {
    platform.electron = true;
    const props = handlers();
    render(<AddHostMethodModal {...props} />);
    fireEvent.click(screen.getByTestId("add-host-method-remote-ssh"));
    expect(props.onRemoteSsh).toHaveBeenCalledTimes(1);
    expect(props.onDirectConnection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("add-host-method-direct"));
    fireEvent.click(screen.getByTestId("add-host-method-pair-link"));
    expect(props.onDirectConnection).toHaveBeenCalledTimes(1);
    expect(props.onPasteLink).toHaveBeenCalledTimes(1);
  });
  it("keeps native QR and does not advertise desktop SSH", () => {
    platform.native = true;
    const props = handlers();
    render(<AddHostMethodModal {...props} />);
    expect(screen.queryByTestId("add-host-method-remote-ssh")).toBeNull();
    fireEvent.click(screen.getByText("pairing.connectionMethods.scanQr.title"));
    expect(props.onScanQr).toHaveBeenCalledTimes(1);
  });
  it("retains the F-Droid QR gate and web/direct alternatives", () => {
    platform.native = true;
    platform.fdroid = true;
    render(<AddHostMethodModal {...handlers()} />);
    expect(screen.queryByText("pairing.connectionMethods.scanQr.title")).toBeNull();
    expect(screen.getByTestId("add-host-method-direct")).toBeTruthy();
    expect(screen.getByTestId("add-host-method-pair-link")).toBeTruthy();
  });
});
