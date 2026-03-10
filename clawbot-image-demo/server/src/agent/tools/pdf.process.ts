/**
 * Tool: pdf.process
 *
 * Extracts text from uploaded PDF documents, summarizes content,
 * or answers questions about the document using the unified LLM interface.
 *
 * Uses pdf-parse (CommonJS) via dynamic import.
 */

import fs from "fs";
import path from "path";
import { textComplete } from "../llm.js";
import { registerTool, type ToolContext } from "./registry.js";

// ── constants ────────────────────────────────────────────

/** Max characters per chunk when splitting long documents for summarization. */
const CHUNK_SIZE = 4000;

// ── helpers ──────────────────────────────────────────────

/**
 * Split text into roughly equal chunks of at most `size` characters,
 * breaking at the nearest newline when possible.
 */
function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + size, text.length);

    // Try to break at a newline within the last 20% of the chunk
    if (end < text.length) {
      const lookback = Math.floor(size * 0.2);
      const newlineIdx = text.lastIndexOf("\n", end);
      if (newlineIdx > start && newlineIdx >= end - lookback) {
        end = newlineIdx + 1;
      }
    }

    chunks.push(text.slice(start, end));
    start = end;
  }

  return chunks;
}

// ── tool registration ───────────────────────────────────

registerTool({
  id: "pdf.process",
  name: "PDF 处理",
  description: "提取、摘要或回答关于已上传 PDF 文档的问题",
  category: "data",
  permissions: ["files.read"],
  argsSchema:
    '{ "file_id": "已上传的文件 ID", "action": "extract_text | summarize | answer_question", "question": "(可选) 要回答的问题" }',
  outputSchema: '{ "text": "提取或摘要的文本内容" }',

  async execute(
    args: { file_id?: string; action?: string; question?: string },
    _ctx: ToolContext,
  ) {
    // ── validate inputs ──────────────────────────────────

    const fileId = (args.file_id ?? "").trim();
    if (!fileId) {
      return { error: "pdf.process requires a non-empty file_id" };
    }

    const action = (args.action ?? "").trim();
    if (!["extract_text", "summarize", "answer_question"].includes(action)) {
      return {
        error:
          "pdf.process requires action to be one of: extract_text, summarize, answer_question",
      };
    }

    // ── resolve and read file ────────────────────────────

    const filePath = path.resolve("src/uploads", fileId);

    if (!fs.existsSync(filePath)) {
      return { error: `File not found: ${filePath}` };
    }

    try {
      // Dynamic import for pdf-parse module
      const pdfParseModule = await import("pdf-parse");
      const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;

      const buffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(buffer);
      const extractedText = (pdfData.text ?? "").trim();

      if (!extractedText) {
        return { error: "PDF appears to contain no extractable text" };
      }

      // ── extract_text ─────────────────────────────────

      if (action === "extract_text") {
        return { text: extractedText };
      }

      // ── summarize ────────────────────────────────────

      if (action === "summarize") {
        let summary: string;

        if (extractedText.length < CHUNK_SIZE) {
          // Short document: single-pass summarization
          summary = await textComplete({
            prompt:
              `请对以下 PDF 文档内容进行简洁的中文摘要，保留关键信息：\n\n${extractedText}`,
            role: "tool",
          });
        } else {
          // Long document: chunk, summarize each, then meta-summarize
          const chunks = chunkText(extractedText, CHUNK_SIZE);

          const chunkSummaries = await Promise.all(
            chunks.map((chunk, i) =>
              textComplete({
                prompt:
                  `这是一份 PDF 文档的第 ${i + 1}/${chunks.length} 部分。` +
                  `请用中文简要概括这部分的要点：\n\n${chunk}`,
                role: "tool",
              }),
            ),
          );

          const combined = chunkSummaries
            .map((s, i) => `【第 ${i + 1} 部分】\n${s}`)
            .join("\n\n");

          summary = await textComplete({
            prompt:
              `以下是一份 PDF 文档各部分的摘要。请将它们综合成一份简洁、连贯的中文总摘要：\n\n${combined}`,
            role: "tool",
          });
        }

        return { text: summary };
      }

      // ── answer_question ──────────────────────────────

      if (action === "answer_question") {
        const question = (args.question ?? "").trim();
        if (!question) {
          return {
            error:
              "answer_question action requires a non-empty question parameter",
          };
        }

        // Truncate context if extremely long to stay within LLM limits
        const maxContext = CHUNK_SIZE * 5;
        const context =
          extractedText.length > maxContext
            ? extractedText.slice(0, maxContext) + "\n\n[...文档内容已截断...]"
            : extractedText;

        const answer = await textComplete({
          prompt:
            `根据以下 PDF 文档内容回答问题。如果文档中没有相关信息，请如实说明。用中文回答。\n\n` +
            `文档内容：\n${context}\n\n问题：${question}`,
          role: "tool",
        });

        return { text: answer };
      }

      // Should not reach here due to earlier validation, but just in case
      return { error: `Unknown action: ${action}` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `PDF processing failed: ${message}` };
    }
  },
});
