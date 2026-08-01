import { isOttoToolName } from "@otto-code/protocol/tool-name-normalization";
import { describeToolCall, type ToolCallRun } from "../grouping";

const DIRECT_OTTO_TOOL_PREFIX = "otto_";
const DIRECT_SEARCH_TOOL_SUFFIX_PATTERN = /(?:^|[_.:/])(?:web_search|llm_context)$/;

export interface OverviewSummary {
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  otherToolCount: number;
  ottoCallCount: number;
}

export interface OverviewToolCallGroup {
  mode: "overview";
  run: ToolCallRun;
  summary: OverviewSummary;
  isLoading: boolean;
}

function isOttoCall(name: string, normalizedName: string): boolean {
  return isOttoToolName(name) || normalizedName.startsWith(DIRECT_OTTO_TOOL_PREFIX);
}

function isSearchCall(name: string): boolean {
  return DIRECT_SEARCH_TOOL_SUFFIX_PATTERN.test(name);
}

export function buildOverviewGroup(run: ToolCallRun): OverviewToolCallGroup {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let isLoading = false;
  let commandCount = 0;
  let searchCount = 0;
  let otherToolCount = 0;
  let ottoCallCount = 0;

  for (const call of run.calls) {
    const descriptor = describeToolCall(call);
    const normalizedName = descriptor.name.trim().toLowerCase();
    isLoading ||= descriptor.status === "running" || descriptor.status === "executing";
    if (isOttoCall(descriptor.name, normalizedName)) {
      ottoCallCount += 1;
    } else if (descriptor.detail.type === "edit" || descriptor.detail.type === "write") {
      editedFiles.add(descriptor.detail.filePath);
    } else if (descriptor.detail.type === "shell") {
      commandCount += 1;
    } else if (descriptor.detail.type === "read") {
      readFiles.add(descriptor.detail.filePath);
    } else if (descriptor.detail.type === "search" || isSearchCall(normalizedName)) {
      searchCount += 1;
    } else {
      otherToolCount += 1;
    }
  }

  const summary = {
    editedFileCount: editedFiles.size,
    commandCount,
    readFileCount: readFiles.size,
    searchCount,
    otherToolCount,
    ottoCallCount,
  };
  return {
    mode: "overview",
    run,
    isLoading,
    summary,
  };
}
