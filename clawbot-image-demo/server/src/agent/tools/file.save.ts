/**
 * Tool: file.save
 *
 * Saves content to a local file.
 */

import fs from "fs";
import path from "path";
import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "file.save",
  name: "保存文件",
  description: "将内容保存为本地文件",
  category: "file",
  permissions: ["files.write"],
  argsSchema: '{ "content": "文件内容", "filename": "文件名", "format": "txt|json|html|md" }',
  outputSchema: '{ "filePath": "保存的文件路径" }',

  async execute(
    args: { content: string; filename: string; format?: string },
    ctx: ToolContext,
  ) {
    const content = args.content ?? "";
    if (!content.trim()) throw new Error("file.save requires non-empty content");

    const format = args.format ?? "txt";
    const basename = (args.filename ?? "output").replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_");
    const filename = basename.endsWith(`.${format}`) ? basename : `${basename}.${format}`;

      const filePath = path.join(ctx.outboxDir, filename);
      // Ensure outbox directory exists
      fs.mkdirSync(ctx.outboxDir, { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");

      return { filePath };
  },
});
