/**
 * Tool: browser.extract_page
 *
 * Server-side schema stub for the planner.
 *
 * Extracts the main visible text content from the current active browser page
 * managed by Playwright on the local Connector. Returns the raw content for
 * the LLM Reporter to summarize.
 *
 * This tool MUST run via connector — server-side execution is not supported.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "browser.extract_page",
  name: "提取当前页面内容",
  description:
    "提取当前浏览器页面的主要文字内容，用于总结或回答问题。当用户说 'summarize this page'、'总结这个页面'、'这个页面说了什么' 时使用此工具。直接读取当前打开的页面，无需提供 URL。",
  category: "system",
  permissions: ["browser.control"],
  argsSchema: '{ "mode": "current_page" }',
  outputSchema:
    '{ "success": true/false, "url": "当前页面URL", "title": "页面标题", "content": "提取的文本内容（已截断到合理长度）", "truncated": true/false, "error": "错误信息（如果失败）" }',

  async execute(_args: any, _ctx: ToolContext) {
    // This tool MUST run via connector — server-side execution is not supported.
    return {
      success: false,
      error:
        "browser.extract_page 必须通过本地 Connector 执行。请确保 Connector 已连接。",
      requiresConnector: true,
    };
  },
});
