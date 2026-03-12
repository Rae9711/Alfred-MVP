/**
 * E2E test: full browser.search_flights flow
 * Run with: node test-e2e.cjs
 */
const WebSocket = require("ws");

const WS_URL = "ws://localhost:8080";
const SESSION_ID = "e2e-test-" + Date.now();
const CONNECTOR_ID = "rae-mac";
const PROMPT = "Search flights from New York to Detroit for March 20";

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
      const ev = msg.event;
      const data = msg.data;
      log(`[event] ${ev} ${JSON.stringify(data || {}).substring(0, 300)}`);

      if (ev === "agent.plan.proposed") {
        checklist.planReceived = true;
        const steps = (data && data.steps) || [];
        stepTool = steps[0] && steps[0].tool;
        log(`   → step[0] tool=${stepTool}`);
        if (stepTool === "browser.search_flights") {
          checklist.correctTool = true;
          log("✅ Correct tool selected: browser.search_flights");
        } else {
          log(`⚠️  Wrong tool: ${stepTool} (expected browser.search_flights)`);
        }
      }

      if (ev === "agent.rendered") {
        checklist.executed = true;
        done = true;
        const text = String((data && (data.text || data.markdown)) || JSON.stringify(data || {})).substring(0, 600);
        log("✅ agent.rendered!");
        log(`   ${text}`);
      }

      if (ev === "agent.plan.error") {
        log(`❌ Plan error: ${JSON.stringify(data)}`);
      }
    }
  });

  ws.on("error", (err) => { log(`❌ WS error: ${err.message}`); process.exit(1); });

  // 1. Bind connector
  log("→ Binding connector...");
  const bindResult = await call(ws, "session.bindConnector", { sessionId: SESSION_ID, connectorId: CONNECTOR_ID });
  checklist.bound = true;
  log(`✅ Bound: connected=${bindResult && bindResult.connected}`);

  // 2. Set immediate mode (auto-execute after plan)
  await call(ws, "session.setActionMode", { sessionId: SESSION_ID, mode: "immediate" });
  log("✅ Mode: immediate");

  // 3. Plan + execute
  log(`→ Planning: "${PROMPT}"`);
  log("   (Chromium will open and search Google Flights — allow ~90s)");
  const planResult = await call(ws, "agent.plan", { sessionId: SESSION_ID, intent: "search_flights", prompt: PROMPT });
  log(`✅ Plan response: planId=${planResult && planResult.planId} autoExecute=${planResult && planResult.autoExecute}`);

  // 4. Wait for agent.rendered
  log("⏳ Waiting for agent.rendered (max 100s)...");
  await new Promise((resolve) => {
    const check = setInterval(() => { if (done) { clearInterval(check); resolve(); } }, 1000);
    setTimeout(() => { clearInterval(check); resolve(); }, 100000);
  });

  console.log("\n=== E2E Checklist ===");
  console.log(`WS connected:         YES`);
  console.log(`Connector bound:      ${checklist.bound ? "YES" : "NO"}`);
  console.log(`Plan received:        ${checklist.planReceived ? "YES" : "NO"}`);
  console.log(`Correct tool:         ${checklist.correctTool ? `YES (${stepTool})` : `NO (got: ${stepTool})`}`);
  console.log(`Execution completed:  ${checklist.executed ? "YES" : "NO - TIMEOUT"}`);

  ws.close();
  process.exit(checklist.executed ? 0 : 1);
}

run().catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
