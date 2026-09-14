// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderToolPolicySection } from "./provider-tool-policy";

vi.mock("react-native", () => ({
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  View: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/screens/settings-search/target", () => ({
  SettingsTargetText: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));
vi.mock("@/components/adaptive-text-input", () => ({
  AdaptiveTextInput: ({
    initialValue,
    resetKey,
    onChangeText,
    editable,
    testID,
  }: {
    initialValue: string;
    resetKey: string;
    onChangeText: (v: string) => void;
    editable: boolean;
    testID: string;
  }) => {
    const onChange = React.useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => onChangeText(e.target.value),
      [onChangeText],
    );
    return (
      <textarea
        key={resetKey}
        data-testid={testID}
        defaultValue={initialValue}
        disabled={!editable}
        onChange={onChange}
      />
    );
  },
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
    disabled,
    testID,
  }: {
    value: boolean;
    onValueChange: (v: boolean) => void;
    disabled: boolean;
    testID: string;
  }) => {
    const onChange = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => onValueChange(e.target.checked),
      [onValueChange],
    );
    return (
      <input
        type="checkbox"
        data-testid={testID}
        checked={value}
        disabled={disabled}
        onChange={onChange}
      />
    );
  },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
    testID,
  }: React.PropsWithChildren<{ onPress: () => void; disabled: boolean; testID: string }>) => (
    <button type="button" data-testid={testID} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

afterEach(cleanup);
const props = { provider: "custom-provider", supported: true, ready: true, policy: undefined };
const blockedPolicy = { disabledTools: ["future_tool"] };
const disabledPolicy = { enabled: false, disabledTools: ["future_tool"] };

describe("provider Otto tool policy controls", () => {
  it("gates old hosts and loading config without sending a patch", () => {
    const patchConfig = vi.fn();
    const { rerender } = render(
      <ProviderToolPolicySection {...props} supported={false} patchConfig={patchConfig} />,
    );
    expect(screen.queryByTestId("provider-otto-tools-enabled")).toBeNull();
    expect(screen.getByText("settings.providers.tools.policy.updateHost")).toBeTruthy();
    rerender(<ProviderToolPolicySection {...props} ready={false} patchConfig={patchConfig} />);
    fireEvent.click(screen.getByTestId("provider-otto-tools-enabled"));
    expect(patchConfig).not.toHaveBeenCalled();
  });

  it("patches the exact custom provider without discarding disabled names or other configuration", async () => {
    let finish!: (value: unknown) => void;
    const patchConfig = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <ProviderToolPolicySection {...props} policy={blockedPolicy} patchConfig={patchConfig} />,
    );
    fireEvent.click(screen.getByTestId("provider-otto-tools-enabled"));
    expect(patchConfig).toHaveBeenCalledWith({
      providers: { "custom-provider": { ottoTools: { enabled: false } } },
    });
    expect((screen.getByTestId("provider-disabled-tools") as HTMLTextAreaElement).disabled).toBe(
      true,
    );
    await act(async () => {
      finish({});
    });
    expect((screen.getByTestId("provider-disabled-tools") as HTMLTextAreaElement).value).toBe(
      "future_tool",
    );
    expect(screen.getByText("settings.providers.tools.saved")).toBeTruthy();
  });

  it("retains failed edits for retry, trims duplicate lines, and allows clearing the deny list", async () => {
    const patchConfig = vi
      .fn()
      .mockRejectedValueOnce(new Error("Host disconnected. Reconnect and retry."))
      .mockResolvedValue({});
    render(
      <ProviderToolPolicySection {...props} policy={disabledPolicy} patchConfig={patchConfig} />,
    );
    fireEvent.change(screen.getByTestId("provider-disabled-tools"), {
      target: { value: " future_tool \ncreate_agent\ncreate_agent\n" },
    });
    fireEvent.click(screen.getByTestId("provider-tool-policy-save"));
    await screen.findByText("Host disconnected. Reconnect and retry.");
    expect((screen.getByTestId("provider-disabled-tools") as HTMLTextAreaElement).value).toContain(
      "create_agent",
    );
    fireEvent.click(screen.getByTestId("provider-tool-policy-save"));
    await screen.findByText("settings.providers.tools.saved");
    expect(patchConfig).toHaveBeenLastCalledWith({
      providers: {
        "custom-provider": { ottoTools: { disabledTools: ["future_tool", "create_agent"] } },
      },
    });
    fireEvent.change(screen.getByTestId("provider-disabled-tools"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("provider-tool-policy-save"));
    await waitFor(() =>
      expect(patchConfig).toHaveBeenLastCalledWith({
        providers: { "custom-provider": { ottoTools: { disabledTools: [] } } },
      }),
    );
  });

  it("reports an unavailable client as failure rather than a successful save", async () => {
    render(
      <ProviderToolPolicySection {...props} patchConfig={vi.fn().mockResolvedValue(undefined)} />,
    );
    fireEvent.click(screen.getByTestId("provider-otto-tools-enabled"));
    await screen.findByText("settings.providers.tools.policy.unavailable");
    expect(screen.queryByText("settings.providers.tools.saved")).toBeNull();
  });
});
