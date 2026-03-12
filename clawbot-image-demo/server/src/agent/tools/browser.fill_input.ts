/**
 * Tool: browser.fill_input
 *
 * Server-side schema stub for the planner.
 *
 * Fills a visible input / textarea / contenteditable field on the page
 * currently open in the Playwright browser running on the local Connector.
 *
 * This tool MUST run via connector — server-side execution is not supported.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "browser.fill_input",
  name: "填写输入框",
  description:
    "在当前浏览器页面中找到并填写输入框、文本域或可编辑区域。支持通过标签文字、占位符文字、CSS 选择器或 ARIA 角色名称定位字段。填写完成后验证字段内容是否已更新。",
  category: "system",
  permissions: ["browser.control"],
  argsSchema: JSON.stringify({
    target: {
      by: "label | placeholder | selector | roleText",
      value: "标签文字 / 占位符 / CSS选择器 / ARIA名称",
    },
    value: "要填写的内容",
    pressEnter: false,
  }),
  outputSchema: JSON.stringify({
    success: true,
    target: { by: "label", value: "..." },
    valuePreview: "前100字符",
    fieldType: "input | textarea | contenteditable",
    verified: true,
    url: "当前页面URL",
    error: "错误信息（如果失败）",
  }),

  async execute(_args: any, _ctx: ToolContext) {
    // This tool MUST run via connector — server-side execution is not supported.
    return {
      success: false,
      error: "browser.fill_input must be executed via the local connector",
    };
  },
});
