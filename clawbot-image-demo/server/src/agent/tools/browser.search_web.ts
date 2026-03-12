/**
 * Tool: browser.search_web
 *
 * Server-side schema stub for the planner.
 *
 * Searches the web using Google via a real Playwright-controlled browser
 * on the user's machine (local Connector). Returns top results with
 * title, URL, and snippet.
 *
 * This tool MUST run via connector — server-side execution is not supported.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "browser.search_web",
  name: "浏览器搜索网页",
  description:
    "在用户电脑上打开真实浏览器搜索网络信息，返回实时搜索结果。当用户说 'Search Ann Arbor weather'、'Search best coffee shops'、'查找最新消息' 等搜索需求时使用此工具。",
  category: "system",
  permissions: ["browser.control"],
  argsSchema: '{ "query": "Ann Arbor weather" }',
  outputSchema:
    '{ "success": true/false, "query": "搜索词", "searchUrl": "搜索页面URL", "results": [{ "title": "标题", "url": "页面URL", "snippet": "摘要" }], "warnings": [], "error": "错误信息（如果失败）" }',

  async execute(_args: any, _ctx: ToolContext) {
    // This tool MUST run via connector — server-side execution is not supported.
    return {
      success: false,
      error:
        "browser.search_web 必须通过本地 Connector 执行。请确保 Connector 已连接。",
      requiresConnector: true,
    };
  },
});
