/**
 * Tool: email.send
 *
 * Sends an email via the user's connected Gmail account using Google Gmail API.
 * Requires a valid Google OAuth access token (set via GOOGLE_ACCESS_TOKEN env var).
 */

import { registerTool, type ToolContext } from "./registry.js";
import { getGoogleToken } from "../../googleAuth.js";

/**
 * Build a raw RFC 2822 message and base64url-encode it for the Gmail API.
 */
function buildRawMessage(to: string, subject: string, body: string, cc?: string): string {
  const lines: string[] = [];
  lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  lines.push(`Subject: =?utf-8?B?${Buffer.from(subject).toString("base64")}?=`);
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("");
  lines.push(body);

  const raw = lines.join("\r\n");
  // base64url encoding (no padding, + → -, / → _)
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

registerTool({
  id: "email.send",
  name: "发送邮件",
  description: "通过用户连接的 Gmail 账户发送邮件",
  category: "platform",
  permissions: ["email.send"],
  argsSchema:
    '{ "to": "收件人邮箱", "subject": "邮件主题", "body": "邮件正文", "cc": "(可选) 抄送收件人" }',
  outputSchema: '{ "sent": true, "messageId": "..." }',

  async execute(
    args: {
      to?: string;
      subject?: string;
      body?: string;
      cc?: string;
    },
    _ctx: ToolContext,
  ) {
    const token = await getGoogleToken();
    if (!token) {
      return {
        error:
          "Google account not connected. Please set GOOGLE_ACCESS_TOKEN.",
      };
    }

    const to = (args.to ?? "").trim();
    if (!to) {
      return { error: "email.send requires a non-empty 'to' address" };
    }

    const subject = (args.subject ?? "").trim();
    const body = (args.body ?? "").trim();

    const raw = buildRawMessage(to, subject, body, args.cc?.trim());

    try {
      const response = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw }),
        },
      );

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        return {
          error: `Gmail API returned ${response.status}: ${errBody || response.statusText}`,
        };
      }

      const data = (await response.json()) as { id?: string };
      return { sent: true, messageId: data.id ?? "sent" };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Failed to send email: ${message}` };
    }
  },
});
