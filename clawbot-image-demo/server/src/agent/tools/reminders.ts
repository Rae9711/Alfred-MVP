/**
 * Tool: reminders.manage
 *
 * Manages tasks in Google Tasks via Google Tasks API.
 * Supports creating, completing, listing, and deleting tasks.
 */

import { registerTool, type ToolContext } from "./registry.js";
import { getGoogleToken } from "../../googleAuth.js";

// ── Google Tasks API base URL ───────────────────────────

const TASKS_BASE = "https://tasks.googleapis.com/tasks/v1";

// ── types ───────────────────────────────────────────────

type ReminderAction = "create" | "complete" | "list" | "delete";

type ReminderArgs = {
  action: ReminderAction;
  title?: string;
  due_date?: string;
  task_id?: string;
  list_name?: string;
};

type TaskList = {
  id?: string;
  title?: string;
};

type GoogleTask = {
  id?: string;
  title?: string;
  status?: string;
  due?: string;
};

// ── helpers ─────────────────────────────────────────────

function resolveDate(input: string): string {
  const s = input.trim().toUpperCase();
  const now = new Date();

  if (s === "TODAY" || s === "NOW") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  if (s === "TOMORROW") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }
  // "2026-03-08" → "2026-03-08T00:00:00.000Z"
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return `${input.trim()}T00:00:00.000Z`;
  }
  // Already has time component
  return input.trim();
}

function formatTask(task: GoogleTask) {
  return {
    id: task.id ?? "",
    title: task.title ?? "",
    status: task.status ?? "",
    due_date: task.due ?? "",
  };
}

/**
 * Resolve the target task list ID by title.
 * Falls back to the default list "@default" if no match.
 */
async function resolveListId(
  token: string,
  listName?: string,
): Promise<{ id: string } | { error: string }> {
  const targetName = (listName ?? "").trim().toLowerCase();

  // If no specific list requested, use the default
  if (!targetName) {
    return { id: "@default" };
  }

  try {
    const response = await fetch(`${TASKS_BASE}/users/@me/lists`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { error: `Failed to fetch task lists: ${response.status} ${text || response.statusText}` };
    }

    const data = (await response.json()) as { items?: TaskList[] };
    const lists = data.items ?? [];

    const match = lists.find(
      (l) => (l.title ?? "").toLowerCase() === targetName,
    );
    if (match?.id) {
      return { id: match.id };
    }
  } catch (e: any) {
    return { error: `Failed to resolve task list: ${e?.message}` };
  }

  // Fallback to default
  return { id: "@default" };
}

// ── tool registration ───────────────────────────────────

registerTool({
  id: "reminders.manage",
  name: "待办管理",
  description: "在 Google Tasks 中创建、完成、查看或删除任务",
  category: "data",
  permissions: ["reminders.write"],
  argsSchema:
    '{ "action": "create | complete | list | delete", "title": "(创建时) 任务标题", "due_date": "(可选) ISO 日期", "task_id": "(完成/删除时) 任务ID", "list_name": "(可选) 列表名" }',
  outputSchema:
    '{ "success": true, "task": { "id": "...", "title": "...", "status": "...", "due_date": "..." } } 或 { "tasks": [...] }',

  async execute(args: ReminderArgs, _ctx: ToolContext) {
    const token = await getGoogleToken();
    if (!token) {
      return { error: "Google account not connected. Please set GOOGLE_ACCESS_TOKEN." };
    }

    const action = (args.action ?? "").trim() as ReminderAction;
    if (!action) {
      return { error: "reminders.manage requires an action (create | complete | list | delete)" };
    }

    try {
      const listResult = await resolveListId(token, args.list_name);
      if ("error" in listResult) {
        return listResult;
      }
      const listId = listResult.id;
      const tasksUrl = `${TASKS_BASE}/lists/${encodeURIComponent(listId)}/tasks`;

      // ── create ──────────────────────────────────────
      if (action === "create") {
        const title = (args.title ?? "").trim();
        if (!title) {
          return { error: "create requires a title" };
        }

        const body: Record<string, any> = { title };
        if (args.due_date) {
          body.due = resolveDate(args.due_date);
        }

        const response = await fetch(tasksUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { error: `Google Tasks API returned ${response.status}: ${text || response.statusText}` };
        }

        const task = (await response.json()) as GoogleTask;
        return { success: true, task: formatTask(task) };
      }

      // ── complete ────────────────────────────────────
      if (action === "complete") {
        const taskId = (args.task_id ?? "").trim();
        if (!taskId) {
          return { error: "complete requires task_id" };
        }

        const response = await fetch(
          `${tasksUrl}/${encodeURIComponent(taskId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status: "completed" }),
          },
        );

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { error: `Google Tasks API returned ${response.status}: ${text || response.statusText}` };
        }

        const task = (await response.json()) as GoogleTask;
        return { success: true, task: formatTask(task) };
      }

      // ── list ────────────────────────────────────────
      if (action === "list") {
        const url = new URL(tasksUrl);
        url.searchParams.set("showCompleted", "false");
        url.searchParams.set("maxResults", "20");

        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { error: `Google Tasks API returned ${response.status}: ${text || response.statusText}` };
        }

        const data = (await response.json()) as { items?: GoogleTask[] };
        const tasks = (data.items ?? []).map(formatTask);
        return { success: true, tasks };
      }

      // ── delete ──────────────────────────────────────
      if (action === "delete") {
        const taskId = (args.task_id ?? "").trim();
        if (!taskId) {
          return { error: "delete requires task_id" };
        }

        const response = await fetch(
          `${tasksUrl}/${encodeURIComponent(taskId)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { error: `Google Tasks API returned ${response.status}: ${text || response.statusText}` };
        }

        return { success: true, deleted: taskId };
      }

      return { error: `Unknown action: ${action}. Use create, complete, list, or delete.` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Reminder operation failed: ${message}` };
    }
  },
});
