/**
 * Tool: wechat.send
 *
 * Sends a message via WeChat using the WeCom Kefu (微信客服) API.
 *
 * WeCom Kefu allows real-time bidirectional chat with external WeChat users.
 * The API uses access_token authentication with 2-hour token lifetime.
 *
 * API reference:
 *   POST https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=TOKEN
 *   Body: { "touser": "external_userid", "open_kfid": "wk...", "msgtype": "text", "text": { "content": "hello" } }
 *
 * Environment variables:
 *   WECOM_CORP_ID      - WeCom enterprise ID (企业ID)
 *   WECOM_CORP_SECRET  - App secret for the kefu-enabled application
 *   WECOM_KF_ID        - Kefu account ID (open_kfid, starts with "wk")
 */

import { registerTool, type ToolContext } from "./registry.js";

const WECOM_CORP_ID = (process.env.WECOM_CORP_ID ?? "").trim();
const WECOM_CORP_SECRET = (process.env.WECOM_CORP_SECRET ?? "").trim();
const WECOM_KF_ID = (process.env.WECOM_KF_ID ?? "").trim();

const WECOM_API = "https://qyapi.weixin.qq.com";

const isConfigured = !!(WECOM_CORP_ID && WECOM_CORP_SECRET && WECOM_KF_ID);

if (isConfigured) {
  console.log(`[wechat.send] WeCom Kefu configured (corp=${WECOM_CORP_ID}, kf=${WECOM_KF_ID})`);
} else {
  console.log("[wechat.send] WeCom not configured — stub mode");
}

// ── Token cache ──

let cachedToken = "";
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 300_000) {
    return cachedToken;
  }

  const url = `${WECOM_API}/cgi-bin/gettoken?corpid=${encodeURIComponent(WECOM_CORP_ID)}&corpsecret=${encodeURIComponent(WECOM_CORP_SECRET)}`;
  const res = await fetch(url);
  const data: any = await res.json();

  if (data.errcode !== 0) {
    throw new Error(`WeCom token error: ${data.errcode} ${data.errmsg}`);
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// ── External user ID mapping ──
// WeChat users who message via Kefu get an external_userid (wm... or wo...).
// We store a mapping from friendly names/aliases to external_userids so the
// planner can use names. This map is populated by the webhook when messages arrive.

export const externalUserMap = new Map<string, { externalUserId: string; name: string }>();

/**
 * Register an external user (called from the webhook when we learn about a user).
 */
export function registerExternalUser(externalUserId: string, name: string) {
  const lower = name.toLowerCase();
  externalUserMap.set(lower, { externalUserId, name });
  // Also store by externalUserId for reverse lookup
  externalUserMap.set(externalUserId, { externalUserId, name });
}

function resolveExternalUserId(recipient: string): string | null {
  // If it already looks like an external userid
  if (recipient.startsWith("wm") || recipient.startsWith("wo")) {
    return recipient;
  }

  const lower = recipient.toLowerCase();
  const entry = externalUserMap.get(lower);
  if (entry) return entry.externalUserId;

  // Fuzzy search
  for (const [key, val] of externalUserMap) {
    if (key.includes(lower) || val.name.toLowerCase().includes(lower)) {
      return val.externalUserId;
    }
  }

  return null;
}

// ── Send message ──

async function sendWeComMessage(toUser: string, content: string): Promise<any> {
  const token = await getAccessToken();
  const url = `${WECOM_API}/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: toUser,
      open_kfid: WECOM_KF_ID,
      msgtype: "text",
      text: { content },
    }),
  });

  const data: any = await res.json();

  if (data.errcode !== 0) {
    throw new Error(`WeCom send error: ${data.errcode} ${data.errmsg}`);
  }

  return data;
}

// Export for use by webhook
export { getAccessToken, sendWeComMessage, isConfigured as isWeComConfigured, WECOM_KF_ID };

// ── Tool registration ──

registerTool({
  id: "wechat.send",
  name: "发送微信消息",
  description: "通过微信发送消息（使用企业微信客服API）",
  category: "platform",
  permissions: ["platform.send"],
  argsSchema: '{ "recipient": "微信联系人名称或external_userid", "message": "消息内容" }',
  outputSchema: '{ "sent": true }',

  async execute(
    args: {
      recipient?: string;
      message?: string;
    },
    _ctx: ToolContext,
  ) {
    const recipient = (args.recipient ?? "").trim();
    const message = (args.message ?? "").trim();

    if (!recipient) {
      return { error: "wechat.send requires a non-empty recipient" };
    }

    if (!message) {
      return { error: "wechat.send requires a non-empty message" };
    }

    // Stub mode
    if (!isConfigured) {
      console.log(`[wechat.send] STUB: would send to "${recipient}": "${message.slice(0, 60)}..."`);
      return {
        sent: true,
        recipient,
        message,
        note: "WeCom not configured — message not actually sent",
      };
    }

    // Resolve recipient to external_userid
    const externalUserId = resolveExternalUserId(recipient);
    if (!externalUserId) {
      return {
        error: `无法找到微信联系人: "${recipient}". 该用户需要先通过客服二维码添加阿福，才能发送消息。`,
      };
    }

    try {
      await sendWeComMessage(externalUserId, message);
      console.log(`[wechat.send] sent to ${recipient} (${externalUserId})`);

      return {
        sent: true,
        recipient,
        externalUserId,
        message,
      };
    } catch (e: any) {
      return {
        error: `WeCom send failed: ${e?.message || String(e)}`,
      };
    }
  },
});
