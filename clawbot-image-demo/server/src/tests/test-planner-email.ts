import "../agent/tools/index.js"; // register tools
import { createPlan } from "../agent/plan.js";

async function run() {
  const sessionId = "test-session";
  const prompt = "Read my latest emails";
  const plan = await createPlan({ sessionId, prompt });
  console.log("plan:", JSON.stringify(plan, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
