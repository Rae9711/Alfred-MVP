/**
 * Tool: browser.manage_calendar
 *
 * Server-side schema stub for the planner.
 *
 * Opens Google Calendar in the local Playwright browser to create or list
 * calendar events by interacting with the UI directly.
 *
 * This tool MUST run via connector — server-side execution is not supported.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "browser.manage_calendar",
  name: "管理 Google 日历",
  description:
    "在用户电脑上打开 Google Calendar，创建或查看日历事件。当用户说「创建日历事件」「add to calendar」「schedule meeting」「查看日程」「安排日程」时使用此工具。",
  category: "system",
  permissions: ["browser.control"],
  argsSchema: JSON.stringify({
    action: "create | list | save",
    title: "(创建时) 事件标题",
    date: "(创建时) 日期 YYYY-MM-DD",
    time: "(创建时，可选) 时间 HH:MM（24小时制）",
    duration: "(创建时，可选) 时长（如 1 hour, 30 minutes）",
    location: "(创建时，可选) 地点",
  }),
  outputSchema: JSON.stringify({
    success: true,
    action: "create | list | save",
    event: { title: "标题", date: "日期", time: "时间", location: "地点" },
    events: [{ title: "标题", date: "日期", time: "时间" }],
    status: "form_ready | login_required | created | created_not_verified | save_failed | error",
    created: true,
    suggestedActions: [{ label: "保存事件", tool: "browser.manage_calendar", args: { action: "save" } }],
    error: "错误信息（如果失败）",
  }),

  async execute(_args: any, _ctx: ToolContext) {
    return {
      success: false,
      error: "browser.manage_calendar must be executed via the local connector",
      requiresConnector: true,
    };
  },
});
