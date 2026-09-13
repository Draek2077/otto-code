import type { ReactElement } from "react";
import { darkTheme } from "@/styles/theme";
import { Settings } from "lucide-react-native";
import { describe, expect, it } from "vitest";
import { Icon, resolvePluginIcon } from "./icons";

describe("Icon", () => {
  it("renders a host Lucide icon with the requested presentation", () => {
    expect(Icon({ name: "Settings", size: 18, color: "#123456" })).toMatchObject({
      type: Settings,
      props: { size: 18, color: "#123456" },
    });
  });

  it("renders nothing for an unknown icon name", () => {
    expect(Icon({ name: "NotALucideIcon" })).toBeNull();
    expect(Icon({ name: "Icon" })).toBeNull();
    expect(Icon({ name: "createLucideIcon" })).toBeNull();
  });
});

it("keeps resolved icons stable and resolves mobile size tokens through the shared theme adapter", () => {
  const Sized = resolvePluginIcon("Settings");
  expect(resolvePluginIcon("Settings")).toBe(Sized);
  const token = Sized({ size: "sm", color: "#123456" }) as ReactElement<{
    uniProps: (theme: typeof darkTheme) => { size: number };
  }>;
  expect(
    token.props.uniProps({ ...darkTheme, iconSize: { ...darkTheme.iconSize, sm: 14 } }),
  ).toEqual({ size: 14 });
  expect(
    token.props.uniProps({ ...darkTheme, iconSize: { ...darkTheme.iconSize, sm: 28 } }),
  ).toEqual({ size: 28 });
  expect(Sized({ size: 18, color: "#123456" })).toMatchObject({
    type: Settings,
    props: { size: 18, color: "#123456" },
  });
});
