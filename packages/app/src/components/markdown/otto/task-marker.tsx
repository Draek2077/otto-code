import React, { Fragment } from "react";
import { Text, type TextStyle } from "react-native";
import { MarkdownTaskCheckbox } from "../task-context";
import { TASK_LINE_ATTRIBUTE, TASK_STATE_ATTRIBUTE } from "../task-lists";

/** The parser removes task syntax; both chat and document rows must restore its marker. */
export function MarkdownListMarker({
  attributes,
  ordered,
  marker,
  style,
  readOnly = false,
  dataSet,
}: {
  attributes?: Record<string, unknown>;
  ordered: boolean;
  marker: string;
  style: TextStyle;
  readOnly?: boolean;
  dataSet?: Record<string, string>;
}) {
  const state = attributes?.[TASK_STATE_ATTRIBUTE];
  if (state !== "checked" && state !== "unchecked") {
    return (
      <Text style={style} dataSet={dataSet}>
        {marker}
      </Text>
    );
  }
  const rawLine = attributes?.[TASK_LINE_ATTRIBUTE];
  const line = typeof rawLine === "string" ? Number.parseInt(rawLine, 10) : Number.NaN;
  return (
    <Fragment>
      {ordered ? (
        <Text style={style} dataSet={dataSet}>
          {marker}
        </Text>
      ) : null}
      <MarkdownTaskCheckbox
        checked={state === "checked"}
        line={!readOnly && Number.isInteger(line) ? line : null}
        style={style}
      />
    </Fragment>
  );
}
