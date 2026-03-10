/**
 * Tool: image.generate
 *
 * Generates a detailed image specification via Ollama and saves it to disk.
 * In production, this would call DALL-E / Stable Diffusion / MidJourney.
 * For the demo, we produce a rich text spec that describes the image.
 */

import fs from "fs";
import path from "path";
import { textComplete } from "../llm.js";
import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "image.generate",
  name: "图片生成",
  description: "生成图片设计稿（海报、图标、插图等）",
  category: "content",
  permissions: [],
  argsSchema: '{ "description": "图片描述", "size?": "1080x1920" }',
  outputSchema: '{ "filePath": "生成的设计稿文件路径", "description": "图片详细描述" }',

  async execute(
    args: { description: string; size?: string },
    ctx: ToolContext,
  ) {
    const description = args.description ?? "";
    if (!description.trim()) {
      throw new Error("image.generate requires a non-empty description");
    }

    const size = args.size ?? "1080x1920";

    // Use Ollama to generate a detailed image spec
    const spec = await textComplete({
      prompt: `You are an image design tool. Generate a detailed visual specification for the following image.

Description: ${description}
Size: ${size}

Output a detailed spec including:
- Color palette (specific hex codes)
- Layout description
- Typography (font suggestions, sizes)
- Key visual elements
- Text content to include

Be specific and actionable. A designer should be able to create this image from your spec.`,
      role: "tool",
    });

    // Save the spec to disk
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `image_spec_${ts}.txt`;
    const filePath = path.join(ctx.outboxDir, filename);

    const content = [
      `=== Image Design Specification ===`,
      `Description: ${description}`,
      `Size: ${size}`,
      `Generated: ${new Date().toISOString()}`,
      ``,
      `--- Detailed Spec ---`,
      spec,
      ``,
      `[NOTE: In production, this spec would be sent to an image generation API`,
      `such as DALL-E, Stable Diffusion, or MidJourney to produce the actual image.]`,
    ].join("\n");

    fs.writeFileSync(filePath, content, "utf-8");

    return {
      filePath,
      description: spec,
    };
  },
});
