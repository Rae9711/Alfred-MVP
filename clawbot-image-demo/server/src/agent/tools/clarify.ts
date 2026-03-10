/**
 * Tool: clarify
 *
 * Asks the user a clarifying question when information is insufficient
 * to proceed with the plan. The actual question delivery is handled by
 * the executor/WebSocket layer — this tool simply returns the question
 * as structured output so the orchestrator can surface it to the user.
 */

import { registerTool, type ToolContext } from "./registry.js";

// ── tool registration ────────────────────────────────────

registerTool({
  id: "clarify",
  name: "询问用户",
  description:
    "当信息不足时向用户提出澄清问题。将所有缺失信息合并为一个问题。",
  category: "data",
  permissions: [],
  argsSchema: '{ "question": "string — 要问用户的问题，自然会话风格" }',
  outputSchema: '{ "asked": true, "question": "the question that was asked" }',

  async execute(
    args: { question: string },
    _ctx: ToolContext,
  ) {
    const question = (args.question ?? "").trim();
    if (!question) {
      throw new Error("clarify requires a non-empty question");
    }

    // The executor/WebSocket layer intercepts this result and
    // delivers the question to the user. We just return the marker.
    return { asked: true, question };
  },
});
