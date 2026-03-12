/**
 * Render the final user-facing message — Call B (Reporter) + optional Call C (Styler).
 *
 * Two-stage output: content → style rewrite.
 *
 *   Reporter: neutral, factual answer built from structured execution receipts.
 *             Prompt receives ONLY: user request + approved plan + execution summary.
 *             No chat history, no previous model responses, no accumulated logs.
 *
 *   Styler:  rewrites wording/structure per persona. Does NOT touch facts.
 *            Uses a cheaper model. Skipped for "professional" (close enough to neutral).
 */

import type { Persona } from "../sessionStore.js";
import { getRun, type RunRecord } from "./executeStore.js";
import { textComplete } from "./llm.js";
import { buildStylerPrompt } from "./persona.js";

function renderBrowserFlightsMessage(run: RunRecord): string | null {
  const flightStep = run.executionSummary.steps.find((s) => s.tool === "browser.search_flights");
  if (!flightStep) return null;

  if (flightStep.status !== "ok") {
    return `航班搜索执行失败：${flightStep.error || "未知错误"}`;
  }

  const output = (flightStep.output && typeof flightStep.output === "object") ? flightStep.output : {};
  const success = output.success === true;
  const flights = Array.isArray(output.flights) ? output.flights : [];
  const warnings = Array.isArray(output.warnings)
    ? output.warnings
    : Array.isArray(output.extractionWarnings)
      ? output.extractionWarnings
      : [];

  const params = output.searchParams || {};
  const verification = output.resultsPageVerification || {};

  const lines: string[] = [];
  lines.push(success ? "已完成 Google Flights 实时搜索。" : "Google Flights 搜索已执行，但结果可能不完整。");

  if (params.origin && params.destination && params.date) {
    lines.push(`查询：${params.origin} → ${params.destination}，日期 ${params.date}`);
  }

  if (verification.finalUrl || verification.selectorMatched || typeof verification.visibleFlightCards === "number") {
    lines.push("结果页验证：");
    lines.push(`- 最终 URL：${verification.finalUrl || output.searchUrl || "未知"}`);
    lines.push(`- 命中选择器：${verification.selectorMatched || "未命中"}`);
    lines.push(`- 可见航班卡片：${typeof verification.visibleFlightCards === "number" ? verification.visibleFlightCards : 0}`);
  }

  if (flights.length > 0) {
    lines.push(`找到 ${flights.length} 条航班（展示前 ${Math.min(5, flights.length)} 条）：`);
    flights.slice(0, 5).forEach((f: any) => {
      lines.push(`- ${f.airline || "Unknown Airline"}｜${f.departure || "--"} → ${f.arrival || "--"}｜${f.duration || "--"}｜${f.stops || "--"}｜${f.price || "--"}`);
    });
  } else {
    lines.push("未提取到可展示的航班条目。可以换日期或重试一次。");
  }

  if (warnings.length > 0) {
    lines.push("注意：本次提取存在部分告警（已返回可用结果）。");
    warnings.slice(0, 3).forEach((w: string) => lines.push(`- ${w}`));
  }

  return lines.join("\n");
}

function renderOpenPageMessage(run: RunRecord): string | null {
  const step = run.executionSummary.steps.find((s) => s.tool === "browser.open_page");
  if (!step) return null;

  if (step.status !== "ok") {
    return `无法打开网页：${step.error || "未知错误"}`;
  }

  const output = (step.output && typeof step.output === "object") ? step.output : {} as any;

  if (!output.success) {
    return `打开网页失败：${output.error || "未知错误"}`;
  }

  const title: string = output.title || output.finalUrl || output.url || "网页";
  const finalUrl: string = output.finalUrl || output.url || "";

  return `已在浏览器中打开 **${title}**。\n访问地址：${finalUrl}`;
}

function renderSearchWebMessage(run: RunRecord): string | null {
  const step = run.executionSummary.steps.find((s) => s.tool === "browser.search_web");
  if (!step) return null;

  if (step.status !== "ok") {
    return `网页搜索执行失败：${step.error || "未知错误"}`;
  }

  const output = (step.output && typeof step.output === "object") ? step.output : {} as any;

  if (!output.success) {
    return `搜索失败：${output.error || "未知错误"}`;
  }

  const results: Array<{ title: string; url: string; snippet: string }> =
    Array.isArray(output.results) ? output.results : [];
  const query: string = output.query || "";
  const warnings: string[] = Array.isArray(output.warnings) ? output.warnings : [];

  const lines: string[] = [];
  lines.push(`以下是关于 **${query}** 的搜索结果：\n`);

  if (results.length === 0) {
    lines.push("未能提取到搜索结果，请重试。");
  } else {
    results.forEach((r, i) => {
      lines.push(`**${i + 1}. ${r.title}**`);
      lines.push(`${r.url}`);
      if (r.snippet) lines.push(`${r.snippet}`);
      lines.push("");
    });
  }

  if (warnings.length > 0) {
    lines.push("注意：搜索存在告警：");
    warnings.slice(0, 3).forEach((w) => lines.push(`- ${w}`));
  }

  return lines.join("\n").trimEnd();
}

function renderClickLinkByTextMessage(run: RunRecord): string | null {
  const step = run.executionSummary.steps.find(
    (s) => s.tool === "browser.click_link_by_text",
  );
  if (!step) return null;

  if (step.status !== "ok") {
    return `无法打开链接：${step.error || "未知错误"}`;
  }

  const output =
    step.output && typeof step.output === "object"
      ? (step.output as any)
      : {};

  if (!output.success) {
    return `打开链接失败：${output.error || "未知错误"}`;
  }

  const title: string = output.title || output.url || "网页";
  const url: string = output.url || "";

  return `已打开：**${title}**\n\n网址：${url}\n\n点击「总结本页」可以提取本页内容。`;
}

// ── Reporter prompt ──────────────────────────────────────

function buildReporterPrompt(run: RunRecord): string {
  // Compact, structured execution results — key outputs only.
  // Preprocess: trim large content fields to avoid token overflow.
  const CONTENT_CAP = 2_000;
  const stepsCompact = run.executionSummary.steps.map((s) => {
    let output = s.output;
    if (output && typeof output === "object" && typeof (output as any).content === "string") {
      const raw = (output as any).content as string;
      if (raw.length > CONTENT_CAP) {
        output = { ...output, content: raw.slice(0, CONTENT_CAP) + "\n…[trimmed for reporter]" };
      }
    }
    return {
      stepId: s.stepId,
      tool: s.tool,
      status: s.status,
      ...(output ? { output } : {}),
      ...(s.error ? { error: s.error } : {}),
    };
  });

  // Debug log to see what's being sent to reporter
  console.log("[render] stepsCompact:", JSON.stringify(stepsCompact, null, 2).substring(0, 2000));

  // Always respond in Chinese (primary market is China)
  const langRule = "必须使用中文输出（必要的专有名词可保留英文）。";

  // Check if this run includes a page extraction — if so, ask reporter to summarize
  const hasExtractPage = run.executionSummary.steps.some((s) => s.tool === "browser.extract_page");
  const extractPageRule = hasExtractPage
    ? "- For browser.extract_page: the output.content field contains raw page text. Summarize it clearly and concisely. Highlight key facts, topics, or information. Do NOT dump the raw text — produce a structured summary."
    : "";

  return `You are a factual reporting assistant. Generate a clear, concise summary based on the execution results.

USER'S ORIGINAL REQUEST:
${run.prompt}

EXECUTION RESULTS:
${JSON.stringify(stepsCompact, null, 2)}

Overall status: ${run.executionSummary.status}

RULES:
- Report ONLY what actually happened based on the execution results above.
- If a tool returned text content (e.g., summaries, extracted text, search results), INCLUDE that content in your response.
- For pdf.process, web.search, or text.generate tools: show the actual "text" or "content" field from their output.
${extractPageRule}
- If a step failed or timed out, say so explicitly. Do not paper over failures.
- If information is missing from the execution log, say "I don't have that data." Do NOT guess.
- Be concise but complete. State facts and include relevant output content.
- Do NOT invent tool outputs or results that aren't in the execution log above.
- ${langRule}

Output a concise factual summary for the user, including the actual content returned by the tools.`;
}

// ── public API ───────────────────────────────────────────

export async function renderFinal(opts: {
  runId: string;
  persona: string;
}): Promise<{ runId: string; persona: string; message: string }> {
  const run = getRun(opts.runId);
  const persona = (opts.persona || "professional") as Persona;

  const browserFlightsMessage = renderBrowserFlightsMessage(run);
  if (browserFlightsMessage) {
    console.log("[render] final rendered response used flight result data");
    return { runId: run.runId, persona, message: browserFlightsMessage };
  }

  const openPageMessage = renderOpenPageMessage(run);
  if (openPageMessage) {
    console.log("[render] final rendered response used open_page result data");
    return { runId: run.runId, persona, message: openPageMessage };
  }

  const clickLinkByTextMessage = renderClickLinkByTextMessage(run);
  if (clickLinkByTextMessage) {
    console.log("[render] final rendered response used click_link_by_text result data");
    return { runId: run.runId, persona, message: clickLinkByTextMessage };
  }

  const searchWebMessage = renderSearchWebMessage(run);
  if (searchWebMessage) {
    console.log("[render] final rendered response used search_web result data");
    return { runId: run.runId, persona, message: searchWebMessage };
  }

  // ── Call B: Reporter (neutral, factual) ──────────────
  console.log("[render] reporter call…");
  const reporterPrompt = buildReporterPrompt(run);
  const neutralContent = await textComplete({
    prompt: reporterPrompt,
    role: "reporter",
  });

  // ── Call C: Styler (always on, ensures selected persona + Chinese tone) ──
  let message: string;
  console.log(`[render] styler call (${persona})…`);
  const stylerPrompt = buildStylerPrompt(persona, neutralContent);
  message = await textComplete({
    prompt: stylerPrompt,
    role: "styler",
  });

  return { runId: run.runId, persona, message };
}
