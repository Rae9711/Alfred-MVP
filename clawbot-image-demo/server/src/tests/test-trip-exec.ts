#!/usr/bin/env -S tsx
import "../agent/tools/index.js"; // register tools
import { createPlan } from "../agent/plan.js";
import { executePlan } from "../agent/execute.js";
import { savePlan } from "../planStore.js";

async function run() {
  const sessionId = "test-session-trip-exec";
  const prompt = "Plan my trip to Detroit tomorrow: find flights, summarize options, and draft an email to my team about the travel plan";

  const plan = await createPlan({ sessionId, prompt });
  console.log('Plan created:', JSON.stringify(plan, null, 2));

  // Simulate user's clarify answer by seeding plan.initialVars
  plan.initialVars = plan.initialVars ?? {};
  plan.initialVars.origin = "New York";
  plan.initialVars.recipient = "team@example.com";
  savePlan(plan.planId, plan);

  const emit = (event: string, data: any) => console.log('[emit]', event, data);

  const fakeExecute = async ({ step, args, localExecute }: any) => {
    if (String(step.tool) === 'browser.search_flights') {
      return { success: true, searchUrl: 'https://flights.example', searchParams: args, flights: [{ airline: 'MockAir', departure: '09:00', arrival: '11:00', duration: '2h', price: '$199' }] };
    }
    if (String(step.tool) === 'browser.compose_gmail_draft') {
      return { success: true, status: 'draft_ready', to: args.to, subject: args.subject, bodyPreview: String(args.body).slice(0, 200) };
    }
    return await localExecute();
  };

  const runResult = await executePlan({ sessionId, planId: plan.planId, approved: true, emit, outboxDir: './src/outbox', executeTool: fakeExecute });
  console.log('Execution summary:', JSON.stringify(runResult.executionSummary, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
