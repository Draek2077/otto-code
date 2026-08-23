import equal from "fast-deep-equal";
import type { AgentUsage } from "@otto-code/protocol/agent-types";

interface AgentUpdateValue {
  updatedAt: Date | string;
  lastUsage?: AgentUsage;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function acceptAgentDirectoryUpdate<T extends AgentUpdateValue>(
  current: T | undefined,
  incoming: T,
): T {
  if (!current) return incoming;
  // A daemon re-broadcasting an unchanged snapshot must not mint a new object:
  // preserved identity is what lets the store skip the write, and the write is
  // what fans out to every mounted subscriber. Measured 2026-08-23: repeated
  // identical 35KB agent_update snapshots each cost an 85-148ms frame, all of
  // it downstream re-rendering.
  if (equal(incoming, current)) return current;
  if (timestamp(incoming.updatedAt) >= timestamp(current.updatedAt)) return incoming;
  if (incoming.lastUsage === undefined) return current;
  if (equal(incoming.lastUsage, current.lastUsage)) return current;
  return { ...current, lastUsage: incoming.lastUsage };
}
