/* ──────────────────────────────────────────────────────────
 *  Execution store – structured execution receipts.
 *
 *  Key principle: tool outputs are *receipts*.
 *  The LLM may interpret them, never fabricate them.
 * ────────────────────────────────────────────────────────── */

export type StepResult = {
  stepId: string;
  tool: string;
  status: "ok" | "error" | "timeout";
  /** Tool return value (only when status === "ok") */
  output?: any;
  /** Error message (only when status !== "ok") */
  error?: string;
};

export type ExecutionSummary = {
  runId: string;
  planId: string;
  status: "ok" | "partial" | "failed";
  steps: StepResult[];
};

export type RunRecord = {
  runId: string;
  planId: string;
  /** Original user prompt, verbatim */
  prompt: string;
  /** Optional connector id used to execute connector tools */
  connectorId?: string | null;
  /** Structured execution receipt – fed to Reporter as-is */
  executionSummary: ExecutionSummary;
  /** stepId → raw tool return value */
  toolResults: Record<string, any>;
};

import { getSupabase } from "../db/supabase.js";

// ── in-memory store ──────────────────────────────────────

const runs = new Map<string, RunRecord>();

export function saveRun(r: RunRecord) {
  runs.set(r.runId, r);

  // Write-through to Supabase (fire-and-forget)
  const sb = getSupabase();
  if (sb) {
    sb.from("runs")
      .upsert({
        run_id: r.runId,
        plan_id: r.planId,
        user_id: (r as any).userId ?? null,
        connector_id: (r as any).connectorId ?? null,
        prompt: r.prompt,
        execution_summary: r.executionSummary,
        tool_results: r.toolResults,
      }, { onConflict: "run_id" })
      .then(({ error }) => {
        if (error) console.error("[supabase] saveRun error:", error.message);
      });
  }
}

export function getRun(runId: string): RunRecord {
  const r = runs.get(runId);
  if (!r) throw new Error(`Run not found: ${runId}`);
  return r;
}
