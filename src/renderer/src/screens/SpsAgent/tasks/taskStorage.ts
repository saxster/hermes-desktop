export const TASKS_DB_FOLDER = "tasks";

export function taskRowPath(rowId: string): string {
  return `${TASKS_DB_FOLDER}/${rowId}.md`;
}
