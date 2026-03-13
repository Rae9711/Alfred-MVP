/**
 * Tool: app.open
 *
 * Server-side schema stub for the planner.
 *
 * Opens an installed desktop application on the user's local macOS machine
 * using `open -a <app name>` via the connector.
 *
 * Use for prompts like:
 *   "Open WeChat"
 *   "Launch Figma"
 *   "Open VSCode"
 *   "Start Zoom"
 *
 * This tool MUST run via connector — server-side execution is not supported.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "app.open",
  name: "打开本地应用",
  description:
    "在用户的 macOS 电脑上打开已安装的桌面应用程序（如 WeChat、Figma、VSCode、Chrome 等）。当用户说「打开 WeChat」「打开 Figma」「launch X」「open X」（X 为桌面应用名称）时使用此工具。",
  category: "system",
  permissions: ["app.open"],
  argsSchema: JSON.stringify({
    name: "应用名称（如 WeChat、Figma、Visual Studio Code）",
  }),
  outputSchema: JSON.stringify({
    success: true,
    app: "实际打开的应用名称",
    opened: true,
    error: "错误信息（如果失败）",
  }),

  async execute(_args: any, _ctx: ToolContext) {
    return {
      success: false,
      app: _args?.name ?? "",
      opened: false,
      error: "app.open must be executed via the local connector",
    };
  },
});
