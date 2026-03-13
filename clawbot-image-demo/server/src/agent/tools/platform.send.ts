/**
 * Tool: platform.send
 *
 * Sends a message (with optional attachments) to a person or channel on a platform.
 * For the demo, this writes a JSON artifact to the outbox directory.
 * In production, this would call the platform's messaging API.
 */

import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "platform.send",
  name: "发送消息",
  description: "通过平台发送消息给联系人或频道",
  category: "platform",
  permissions: ["platform.send"],
  argsSchema:
    '{ "recipientId": "接收者ID", "recipientName": "接收者姓名", ' +
    '"platform": "wecom|dingtalk|feishu", "message": "消息内容", ' +
    '"attachments?": ["附件文件路径"] }',
  outputSchema: '{ "sent": true, "messageId": "消息ID", "artifact": "本地存档路径" }',

  async execute(
    args: {
      recipientId?: string;
      recipientName?: string;
      platform?: string;
      message?: string;
      attachments?: string[];
    },
    ctx: ToolContext,
  ) {
    const message = (args.message ?? "").trim();
    if (!message) throw new Error("platform.send requires a non-empty message");

    const platform = args.platform ?? "wecom";
    const recipientName = args.recipientName ?? "unknown";
    const messageId = nanoid(10);

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `send_${platform}_${ts}.json`;
    const filePath = path.join(ctx.outboxDir, filename);

    const payload = {
      messageId,
      platform,
      recipientId: args.recipientId ?? null,
      recipientName,
      message,
      attachments: args.attachments ?? [],
      createdAt: new Date().toISOString(),
    };

      fs.mkdirSync(ctx.outboxDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");

      console.log(`[platform.send] Message to ${recipientName} (${platform}): "${message.slice(0, 50)}…"`);

      return {
        sent: true,
        messageId,
        artifact: filePath,
        recipientName,
      platform,
    };
  },
});
