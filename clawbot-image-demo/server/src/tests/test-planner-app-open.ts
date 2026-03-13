import "../agent/tools/index.js"; // ensure tools register into the registry
import { createPlan } from "../agent/plan.js";

async function run() {
  const prompts = [
    "打开微信",
    "打开短信",
    "打开 VSCode",
    "打开 Figma",
    "打开 ChatGPT",
    "打开 Google",
  ];

  for (const p of prompts) {
    try {
      console.log("\n=== PROMPT:", p);
      const plan = await createPlan({ sessionId: "test-session", prompt: p });
      console.log(JSON.stringify(plan, null, 2));
    } catch (e) {
      console.error("Error for prompt", p, e);
    }
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
