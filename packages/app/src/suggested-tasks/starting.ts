export function areAllSuggestedTasksStarting(
  taskIds: readonly string[],
  startingTaskIds: ReadonlySet<string>,
): boolean {
  return taskIds.length > 0 && taskIds.every((taskId) => startingTaskIds.has(taskId));
}
