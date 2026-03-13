import "../agent/tools/index.js"; // register tools
import { createPlan } from "../agent/plan.js";
import { executePlan } from "../agent/execute.js";
import { bindConnector } from "../sessionStore.js";
import { registerConnector, resolveConnectorResult, getConnectedConnectorIds } from "../connectorHub.js";

async function run() {
  const sessionId = "test-session-exec";
  const connectorId = "rae-mac";

  // Fake connector socket that responds to invoke with a successful open result
  const fakeSocket: any = {
    send: (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg?.type === "connector.invoke") {
          // Simulate async response
          setTimeout(() => {
            resolveConnectorResult({ requestId: msg.data.requestId, ok: true, result: { success: true, app: msg.data.args?.name || msg.data.args?.alias || "WeChat", opened: true } });
          }, 50);
        }
      } catch (e) {
        console.error("fakeSocket parse error", e);
      }
    },
  };

  registerConnector(connectorId, fakeSocket);
  console.log("registered connectors:", getConnectedConnectorIds());

  // Bind the session to this connector
  bindConnector(sessionId, connectorId);
  console.log(`bound session ${sessionId} -> ${connectorId}`);

  // Create plan
  const plan = await createPlan({ sessionId, prompt: "打开微信" });
  console.log("plan:", JSON.stringify(plan, null, 2));

  // Execute plan
  const run = await executePlan({ sessionId, planId: plan.planId, approved: true, emit: (_e, _d) => {}, outboxDir: "./src/outbox" });
  console.log("run result:", JSON.stringify(run, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
