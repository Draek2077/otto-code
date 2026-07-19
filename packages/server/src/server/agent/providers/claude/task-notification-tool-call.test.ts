import { describe, expect, it } from "vitest";

import {
  isTaskNotificationUserContent,
  mapTaskNotificationSystemRecordToToolCall,
  mapTaskNotificationUserContentToToolCall,
} from "./task-notification-tool-call.js";

describe("task-notification-tool-call", () => {
  it("detects task notification user content in string payloads", () => {
    expect(
      isTaskNotificationUserContent(
        "<task-notification>\n<task-id>bg-1</task-id>\n</task-notification>",
      ),
    ).toBe(true);
    expect(isTaskNotificationUserContent("hello")).toBe(false);
  });

  it("maps user content to completed synthetic tool call", () => {
    const content =
      "<task-notification>\n<task-id>bg-1</task-id>\n<status>completed</status>\n</task-notification>";
    const item = mapTaskNotificationUserContentToToolCall({
      content,
      messageId: "task-note-user-1",
    });

    expect(item).toEqual({
      type: "tool_call",
      callId: "task_notification_task-note-user-1",
      name: "task_notification",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        label: "Background task completed",
        icon: "wrench",
        text: content,
      },
      metadata: {
        synthetic: true,
        source: "claude_task_notification",
        taskId: "bg-1",
        status: "completed",
      },
    });
  });

  it("maps system task notification to failed synthetic tool call", () => {
    const item = mapTaskNotificationSystemRecordToToolCall({
      type: "system",
      subtype: "task_notification",
      uuid: "task-note-system-1",
      task_id: "bg-fail-1",
      status: "failed",
      summary: "Background task failed",
      output_file: "/tmp/bg-fail-1.txt",
    });

    expect(item).toEqual({
      type: "tool_call",
      callId: "task_notification_task-note-system-1",
      name: "task_notification",
      status: "failed",
      error: { message: "Background task failed" },
      detail: {
        type: "plain_text",
        label: "Background task failed",
        icon: "wrench",
        text: "Background task failed",
      },
      metadata: {
        synthetic: true,
        source: "claude_task_notification",
        taskId: "bg-fail-1",
        status: "failed",
        outputFile: "/tmp/bg-fail-1.txt",
      },
    });
  });

  it("returns null for non-task system records", () => {
    const item = mapTaskNotificationSystemRecordToToolCall({
      subtype: "init",
    });

    expect(item).toBeNull();
  });

  it("ignores bare queue-operation bookkeeping records", () => {
    // Claude Code writes this enqueue/dequeue pair as the first two lines of every transcript.
    // Treating them as notifications put a phantom "Background task notification" chip at the
    // top of every chat.
    for (const operation of ["enqueue", "dequeue"]) {
      expect(
        mapTaskNotificationSystemRecordToToolCall({
          type: "queue-operation",
          operation,
          timestamp: "2026-07-19T18:58:21.421Z",
          sessionId: "4c431c1d-8c5c-4ff7-96f3-b504ba5b8f4f",
        }),
      ).toBeNull();
    }
  });

  it("ignores queue-operation records whose content is not a task notification", () => {
    expect(
      mapTaskNotificationSystemRecordToToolCall({
        type: "queue-operation",
        operation: "enqueue",
        uuid: "queue-plain-1",
        content: "just a queued prompt",
      }),
    ).toBeNull();
  });

  it("still maps queue-operation records that carry a task notification payload", () => {
    const content = [
      "<task-notification>",
      "<task-id>bg-queue-1</task-id>",
      "<status>completed</status>",
      "<summary>Background task completed</summary>",
      "</task-notification>",
    ].join("\n");

    expect(
      mapTaskNotificationSystemRecordToToolCall({
        type: "queue-operation",
        operation: "enqueue",
        uuid: "task-note-queue-1",
        content,
      }),
    ).toEqual({
      type: "tool_call",
      callId: "task_notification_task-note-queue-1",
      name: "task_notification",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        label: "Background task completed",
        icon: "wrench",
        text: content,
      },
      metadata: {
        synthetic: true,
        source: "claude_task_notification",
        taskId: "bg-queue-1",
        status: "completed",
      },
    });
  });
});
