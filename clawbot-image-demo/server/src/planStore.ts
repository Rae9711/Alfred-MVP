export type PlanStep = {
  id: string;
  action: string;
  tools: string[];
  risk: "low" | "medium" | "high";
  needsApproval: boolean;
};

export type Plan = {
  planId: string;
  sessionId: string;
  riskTags: string[];
  confirmationText: string;
  steps: PlanStep[];
  imageUrl?: string;
  teamTarget: string;
};

import { getSupabase } from "./db/supabase.js";

const plans = new Map<string, any>();

export function savePlan(planId: string, plan: any) {
  plans.set(planId, plan);

  // Write-through to Supabase (fire-and-forget)
  const sb = getSupabase();
  if (sb) {
    sb.from("plans")
      .upsert({
        plan_id: planId,
        session_id: plan.sessionId ?? null,
        user_id: plan.userId ?? null,
        plan_data: plan,
      }, { onConflict: "plan_id" })
      .then(({ error }) => {
        if (error) console.error("[supabase] savePlan error:", error.message);
      });
  }
}

export function getPlan(planId: string) {
  const p = plans.get(planId);
  if (!p) throw new Error(`Plan not found: ${planId}`);
  return p;
}
