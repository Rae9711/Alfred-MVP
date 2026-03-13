#!/usr/bin/env -S tsx
import "../agent/tools/index.js"; // register tools
import { createPlan } from "../agent/plan.js";
import { executePlan } from "../agent/execute.js";

async function runDemoPrompt(sessionId: string, prompt: string) {
  console.log(`\n--- Prompt: ${prompt}`);
  const plan = await createPlan({ sessionId, prompt });
  console.log('Plan:', JSON.stringify(plan, null, 2));

  const emit = (event: string, data: any) => {
    console.log('[emit]', event, JSON.stringify(data));
  };

  const run = await executePlan({ sessionId, planId: plan.planId, approved: true, emit, outboxDir: './src/outbox' });
  console.log('Execution summary:', JSON.stringify(run.executionSummary, null, 2));

  const bad = run.executionSummary.steps.filter((s: any) => s.status !== 'ok');
  if (bad.length) {
    console.error('One or more steps failed or timed out:', bad.map((b: any) => ({ stepId: b.stepId, tool: b.tool, status: b.status, error: b.error })));
    return false;
  }

  return true;
}

async function run() {
  const sessionId = 'test-session-investor';

  const prompts = [
    // Example investor demo prompts — adjust as needed
    'Research the top 3 latest funding rounds in AI startups this month and summarize the findings into a short email to my team',
    'Find recent news about startup Y Combinator alumni and draft a short investor-update email',
  ];

  for (let i = 0; i < prompts.length; i++) {
    const ok = await runDemoPrompt(`${sessionId}-${i + 1}`, prompts[i]);
    if (!ok) {
      console.error('Investor demo failed for prompt index', i);
      process.exit(1);
    }
  }

  console.log('\nInvestor demo completed successfully for all prompts.');
  process.exit(0);
}

run().catch((e) => { console.error('Test failed:', e); process.exit(1); });
