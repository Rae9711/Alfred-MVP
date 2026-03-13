import "../agent/tools/index.js"; // register tools
import { createPlan } from "../agent/plan.js";

async function run() {
  const sessionId = "test-session-trip";
  const prompt = "Plan my trip to Detroit tomorrow: find flights, summarize options, and draft an email to my team about the travel plan";
  const plan = await createPlan({ sessionId, prompt });
  console.log(JSON.stringify(plan, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
