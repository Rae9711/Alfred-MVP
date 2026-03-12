/**
 * Tool: browser.open_page
 *
 * Server-side schema stub for the planner.
 *
 * Opens a URL in the user's browser via the local Connector (Playwright).
 * Returns the final URL and page title after navigation.
 *
 * This tool MUST run via connector — server-side execution is not supported.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "browser.open_page",
  name: "打开网页",
  description:
    "在用户电脑上打开指定网页（Gmail、ChatGPT、Amazon、OpenAI 等）。当用户说 'Open Gmail'、'Open ChatGPT'、'打开亚马逊' 时使用此工具。",
  category: "system",
  permissions: ["browser.control"],
  argsSchema: '{ "url": "https://example.com" }',
  outputSchema:
    '{ "success": true/false, "url": "请求的URL", "finalUrl": "最终页面URL（可能有重定向）", "title": "页面标题", "error": "错误信息（如果失败）" }',

  async execute(_args: any, _ctx: ToolContext) {
    // This tool MUST run via connector — server-side execution is not supported.
    return {
      success: false,
      error:
        "browser.open_page 必须通过本地 Connector 执行。请确保 Connector 已连接。",
      requiresConnector: true,
    };
  },
});
