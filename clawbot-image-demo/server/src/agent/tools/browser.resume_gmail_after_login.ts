/**
 * Tool: browser.resume_gmail_after_login
 *
 * Server-side schema stub for the planner.
 *
 * Called automatically when the user clicks "I have signed in, continue"
 * after a login_required pause from browser.compose_gmail_draft.
 *
 * Re-checks Gmail login state, then continues the compose workflow if
 * signed in. Returns login_required again if still not signed in.
 *
 * This tool MUST run via connector — server-side execution is not supported.
 */

import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "browser.resume_gmail_after_login",
  name: "登录后继续撰写 Gmail 草稿",
  description:
    "用户手动登录 Gmail 后，继续之前暂停的草稿撰写流程。重新检查登录状态，如已登录则打开撰写窗口并填写收件人、主题和正文。不会自动发送邮件。",
  category: "system",
  permissions: ["browser.control"],
  argsSchema: JSON.stringify({
    to: "收件人邮箱地址",
    subject: "邮件主题",
    body: "邮件正文",
  }),
  outputSchema: JSON.stringify({
    success: true,
    status: "draft_ready | login_required | compose_failed | fill_failed | error",
    to: "收件人邮箱",
    subject: "邮件主题",
    bodyPreview: "正文前100字符",
    sendReady: true,
    url: "当前页面URL",
    message: "状态说明",
    suggestedActions: "如果仍未登录，提供继续按钮",
  }),

  async execute(_args: any, _ctx: ToolContext) {
    return {
      success: false,
      status: "error",
      error: "browser.resume_gmail_after_login must be executed via the local connector",
    };
  },
});
