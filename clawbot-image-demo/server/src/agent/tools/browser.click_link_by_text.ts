/**
 * Tool: browser.click_link_by_text
 *
 * Server-side schema stub for the planner.
 *
 * Opens the Nth search result from the currently displayed search results
 * page in the Playwright browser running on the local Connector.
 *
 * This tool is primarily triggered via suggestedActions returned by
 * browser.search_web, but can also be called by the planner directly.
 *
 * This tool MUST run via connector — server-side execution is not supported.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "browser.click_link_by_text",
  name: "打开搜索结果链接",
  description:
    "在当前搜索结果页面中打开第 N 条结果链接。当用户说 'open the first result'、'打开第一个结果'、'open second result' 时使用此工具。需要先执行 browser.search_web。",
  category: "system",
  permissions: ["browser.control"],
  argsSchema: '{ "ordinal": 1 }',
  outputSchema:
    '{ "success": true/false, "url": "打开的页面URL", "title": "页面标题", "message": "结果描述", "suggestedActions": [{ "tool": "browser.extract_page", "label": "Summarize this page", "args": { "mode": "current_page" } }], "error": "错误信息（如果失败）" }',

  async execute(_args: any, _ctx: ToolContext) {
    // This tool MUST run via connector — server-side execution is not supported.
    return {
      success: false,
      error:
        "browser.click_link_by_text 必须通过本地 Connector 执行。请确保 Connector 已连接。",
      requiresConnector: true,
    };
  },
});
