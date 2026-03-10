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

// ── Reporter prompt ──────────────────────────────────────

function buildReporterPrompt(run: RunRecord): string {
  // Compact, structured execution results — key outputs only
  const stepsCompact = run.executionSummary.steps.map((s) => ({
    stepId: s.stepId,
    tool: s.tool,
    status: s.status,
    ...(s.output ? { output: s.output } : {}),
    ...(s.error ? { error: s.error } : {}),
  }));

  // Always respond in Chinese (primary market is China)
  const langRule = "必须使用中文输出（必要的专有名词可保留英文）。";

  return `You are a factual reporting assistant. Generate a clear, concise summary based on the execution results.

USER'S ORIGINAL REQUEST:
${run.prompt}

EXECUTION RESULTS:
${JSON.stringify(stepsCompact, null, 2)}

Overall status: ${run.executionSummary.status}

RULES:
- Report ONLY what actually happened based on the execution results above.
- If a step failed or timed out, say so explicitly. Do not paper over failures.
- If information is missing from the execution log, say "I don't have that data." Do NOT guess.
- Be concise. State facts. No personality or style — that comes later.
- Do NOT invent tool outputs or results that aren't in the execution log above.
- ${langRule}

Output a concise factual summary for the user.`;
}

// ── public API ───────────────────────────────────────────

export async function renderFinal(opts: {
  runId: string;
  persona: string;
}): Promise<{ runId: string; persona: string; message: string }> {
  const run = getRun(opts.runId);
  const persona = (opts.persona || "professional") as Persona;

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
