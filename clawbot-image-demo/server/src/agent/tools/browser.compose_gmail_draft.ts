/**
 * Tool: browser.compose_gmail_draft
 *
 * Server-side schema stub for the planner.
 *
 * Opens Gmail in the local Playwright browser, clicks Compose, fills the
 * To / Subject / Body fields, and stops before Send — leaving the draft
 * fully visible and ready for the user to review.
 *
 * This tool MUST run via connector — server-side execution is not supported.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "browser.compose_gmail_draft",
  name: "撰写 Gmail 草稿",
  description:
    "在用户电脑上打开 Gmail，点击「撰写」，填写收件人、主题和正文，然后暂停（不发送）。当用户说「帮我写邮件」「起草邮件」「compose email」「draft gmail」时使用此工具。需要用户已在浏览器中登录 Gmail。",
  category: "system",
  permissions: ["browser.control"],
  argsSchema: JSON.stringify({
    to: "收件人邮箱地址",
    subject: "邮件主题",
    body: "邮件正文",
  }),
  outputSchema: JSON.stringify({
    success: true,
    status: "draft_ready | not_logged_in | compose_failed | fill_failed | error",
    to: "收件人邮箱",
    subject: "邮件主题",
    bodyPreview: "正文前100字符",
    sendReady: true,
    url: "当前页面URL",
    error: "错误信息（如果失败）",
  }),

  async execute(_args: any, _ctx: ToolContext) {
    // This tool MUST run via connector — server-side execution is not supported.
    return {
      success: false,
      status: "error",
      error: "browser.compose_gmail_draft must be executed via the local connector",
    };
  },
});
