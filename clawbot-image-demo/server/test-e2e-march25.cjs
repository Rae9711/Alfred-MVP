/**
 * E2E test: full browser.search_flights flow with March 25
 * Run with: node test-e2e-march25.cjs
 */
const WebSocket = require("ws");

const WS_URL = "ws://localhost:8080";
const SESSION_ID = "e2e-test-" + Date.now();
const CONNECTOR_ID = "rae-mac";
const PROMPT = "Search flights from New York to Detroit for March 25";

// JSON-RPC style: { id, method, params }
let msgId = 1;
const pending = {};
let startTime = Date.now();
let done = false;
let stepTool = null;
let checklist = { bound: false, planReceived: false, correctTool: false, executed: false };

function log(msg) {
  console.log(`[${((Date.now() - startTime) / 1000).toFixed(1)}s] ${msg}`);
}

function call(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = String(msgId++);
    pending[id] = { resolve, reject };
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function run() {
  const ws = new WebSocket(WS_URL);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  log("✅ WebSocket connected");

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    // RPC response
    if (msg.id && pending[msg.id]) {
      const cb = pending[msg.id];
      delete pending[msg.id];
      msg.ok !== false ? cb.resolve(msg.result) : cb.reject(new Error(msg.error || "rpc error"));
      return;
    }

    // Events
    if (msg.type === "event") {
      const name = msg.payload?.name || "";
      log(`[event] ${name} ${JSON.stringify(msg.payload).substring(0, 200)}`);

      // Capture executed tool
      if (name === "agent.exec.step" && msg.payload.tool) {
        stepTool = msg.payload.tool;
      }

      if (name === "tool.success") {
        checklist.executed = true;
      }

      if (name === "agent.rendered") {
        log("✅ agent.rendered!");
        log(`   ${JSON.stringify(msg.payload, null, 2).substring(0, 2000)}`);
        done = true;
      }
    }
  });

  try {
    // BIND
    log("→ Binding connector...");
    await call(ws, "connector.bind", { connectorId: CONNECTOR_ID });
    checklist.bound = true;
    log("✅ Bound: connected=true");

    // PLANNING
    log("✅ Mode: immediate");
    log(`→ Planning: "${PROMPT}"`);
    log("   (Chromium will open and search Google Flights — allow ~90s)");

    const planResp = await call(ws, "agent.plan", {
      sessionId: SESSION_ID,
      prompt: PROMPT,
      userContext: { userId: "test-user", name: "Test User" },
    });

    if (planResp.plan?.steps?.[0]?.tool) {
      stepTool = planResp.plan.steps[0].tool;
      log(`   → step[0] tool=${stepTool}`);
      if (stepTool === "browser.search_flights") {
        checklist.correctTool = true;
        log("✅ Correct tool selected: browser.search_flights");
      } else {
        log(`❌ WRONG TOOL: expected browser.search_flights, got ${stepTool}`);
      }
    }

    checklist.planReceived = true;
    log(`✅ Plan response: planId=${planResp.plan?.id} autoExecute=${planResp.plan?.autoExecute}`);

    // WAIT for rendered
    log("⏳ Waiting for agent.rendered (max 100s)...");
    await new Promise((resolve) => {
      let elapsed = 0;
      const interval = setInterval(() => {
        elapsed++;
        if (done || elapsed > 100) {
          clearInterval(interval);
          resolve();
        }
      }, 1000);
    });

    ws.close();

    // RESULTS
    console.log("\n=== E2E Checklist ===");
    console.log(`WS connected:         ${checklist.bound ? "YES" : "NO"}`);
    console.log(`Connector bound:      ${checklist.bound ? "YES" : "NO"}`);
    console.log(`Plan received:        ${checklist.planReceived ? "YES" : "NO"}`);
    console.log(`Correct tool:         ${checklist.correctTool ? "YES" : `NO (got: ${stepTool})`}`);
    console.log(`Execution completed:  ${checklist.executed ? "YES" : "NO"}`);

    if (!checklist.correctTool) {
      process.exit(1);
    }
    if (!done) {
      console.log("\n⚠ Test timed out — no agent.rendered event received.");
      process.exit(1);
    }
    process.exit(0);

  } catch (err) {
    console.error("✗ E2E test failed:", err.message);
    ws.close();
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
