/**
 * Tool: browser.submit_chatgpt_prompt
 *
 * Server-side schema stub for the planner.
 *
 * Opens ChatGPT in the local Playwright browser, fills the prompt input,
 * submits it, waits for the response, and returns the visible assistant reply.
 *
 * This tool MUST run via connector — server-side execution is not supported.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "browser.submit_chatgpt_prompt",
  name: "向 ChatGPT 发送提问",
  description:
    "在用户电脑上打开 ChatGPT，填写提示词，提交后等待回答，并返回 AI 的完整回复。当用户说「问 ChatGPT」「让 ChatGPT 回答」「用 ChatGPT 生成」「ask chatgpt」时使用此工具。需要用户已在浏览器中登录 ChatGPT。",
  category: "system",
  permissions: ["browser.control"],
  argsSchema: JSON.stringify({
    prompt: "要发送给 ChatGPT 的提词内容",
  }),
  outputSchema: JSON.stringify({
    success: true,
    promptPreview: "提词前200字符",
    response: "ChatGPT 的回复文本",
    truncated: false,
    url: "当前页面URL",
    error: "错误信息（如果失败）",
  }),

  async execute(_args: any, _ctx: ToolContext) {
    // This tool MUST run via connector — server-side execution is not supported.
    return {
      success: false,
      error: "browser.submit_chatgpt_prompt must be executed via the local connector",
    };
  },
});
