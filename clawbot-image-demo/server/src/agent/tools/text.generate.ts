/**
 * Tool: text.generate
 *
 * Generates text content (copywriting, summaries, translations) via Ollama.
 * This is an explicit, approved tool call — not a hidden LLM detour.
 */

import { textComplete } from "../llm.js";
import { registerTool, type ToolContext } from "./registry.js";

registerTool({
  id: "text.generate",
  name: "文本生成",
  description: "生成文本内容（文案、摘要、翻译等）",
  category: "content",
  permissions: [],
  argsSchema: '{ "prompt": "要生成的内容描述", "style?": "formal|casual|festive" }',
  outputSchema: '{ "text": "生成的文本内容" }',

  async execute(args: { prompt: string; style?: string }, _ctx: ToolContext) {
    const prompt = args.prompt ?? "";
    if (!prompt.trim()) throw new Error("text.generate requires a non-empty prompt");

    const styleHint = args.style ? `\nStyle: ${args.style}` : "";

    const text = await textComplete({
      prompt: `${prompt}${styleHint}\n\n直接输出内容，用中文，不要解释或评论。`,
      role: "tool",
    });

    return { text };
  },
});
