/**
 * Tool: browser.read_gmail
 *
 * Server-side schema stub for the planner.
 *
 * Opens Gmail in the local Playwright browser, reads the inbox, and returns
 * the most recent emails with sender, subject, date, and preview.
 *
 * This tool MUST run via connector — server-side execution is not supported.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "browser.read_gmail",
  name: "读取 Gmail 收件箱",
  description:
    "在用户电脑上打开 Gmail，读取收件箱中最新的邮件列表（发件人、主题、日期、摘要）。这是专用于读取 Gmail 收件箱的工具 — 不要将其与通用网页搜索 `browser.search_web` 混淆。 当用户说「查看邮件」「读邮件」「check email」「read gmail」「查看收件箱」时使用此工具。",
  category: "system",
  permissions: ["browser.control"],
  argsSchema: JSON.stringify({
    count: "(可选) 读取邮件数量，默认 5",
    query: "(可选) Gmail 搜索关键词，如 from:boss@company.com 或 subject:invoice",
  }),
  outputSchema: JSON.stringify({
    success: true,
    emails: [{ from: "发件人", subject: "主题", date: "日期", preview: "邮件预览", unread: true }],
    count: 5,
    error: "错误信息（如果失败）",
  }),

  async execute(_args: any, _ctx: ToolContext) {
    return {
      success: false,
      error: "browser.read_gmail must be executed via the local connector",
      requiresConnector: true,
    };
  },
});
