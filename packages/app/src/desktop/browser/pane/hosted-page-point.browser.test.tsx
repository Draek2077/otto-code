import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { Pressable, type GestureResponderEvent } from "react-native";
import { describe, expect, it } from "vitest";
import { pagePointFromPane, pressPointInPane } from "./hosted-page-point";

const paneStyle = { position: "absolute", left: 40, top: 100, width: 200, height: 400 } as const;

const seen: { location: unknown; point: unknown }[] = [];

function record(event: GestureResponderEvent): void {
  seen.push({
    location: (event.nativeEvent as { locationX?: number }).locationX,
    point: pressPointInPane(event),
  });
}

describe("where a press lands on a hosted page", () => {
  it("reads a desktop click, which carries no press location of its own", () => {
    seen.length = 0;
    const screen = render(<Pressable testID="pane" style={paneStyle} onPress={record} />);

    fireEvent.click(screen.getByTestId("pane"), { clientX: 90, clientY: 160 });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.location).toBeUndefined();
    expect(seen[0]!.point).toEqual({ x: 50, y: 60 });
  });

  it("uses the press location a phone reports", () => {
    const event = { nativeEvent: { locationX: 12, locationY: 34 } } as GestureResponderEvent;
    expect(pressPointInPane(event)).toEqual({ x: 12, y: 34 });
  });

  it("maps the pane to the page it shows, scaled and centred", () => {
    const pane = { width: 400, height: 400 };
    const page = { width: 800, height: 400 };
    // The page is drawn at half size, 400 by 200, with 100 of margin above.
    expect(pagePointFromPane({ x: 200, y: 200 }, pane, page)).toEqual({ x: 400, y: 200 });
    expect(pagePointFromPane({ x: 0, y: 100 }, pane, page)).toEqual({ x: 0, y: 0 });
  });

  it("ignores a press on the margin beside the page", () => {
    const pane = { width: 400, height: 400 };
    const page = { width: 800, height: 400 };
    expect(pagePointFromPane({ x: 200, y: 50 }, pane, page)).toBeNull();
    expect(pagePointFromPane({ x: 200, y: 350 }, pane, page)).toBeNull();
  });
});
