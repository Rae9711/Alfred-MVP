/**
 * Quick roundtrip check for browser.search_web
 * Plan → execute → wait for agent.rendered event
 */

const WebSocket = require("ws");

const WS_URL = "ws://localhost:8080";
const SESSION_ID = `test-sw-${Date.now()}`;
const CONNECTOR_ID = "rae-mac";
const PROMPT = "Search Ann Arbor weather";

let msgId = 1;
const pending = {};
let planId = null;
let startTime = Date.now();

function log(msg) {
  console.log(`[${((Date.now() - startTime) / 1000).toFixed(1)}s] ${msg}`);
}

async function run() {
  const ws = new WebSocket(WS_URL);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  log("✓ Connected");

  function call(method, params) {
    return new Promise((resolve, reject) => {
      const id = String(msgId++);
      pending[id] = { resolve, reject };
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending[id]) { delete pending[id]; reject(new Error(`Timeout: ${method}`)); } }, 120_000);
    });
  }

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.id && pending[msg.id]) {
      const cb = pending[msg.id];
      delete pending[msg.id];
      msg.ok !== false ? cb.resolve(msg.result) : cb.reject(new Error(msg.error || "rpc error"));
      return;
    }

    if (msg.type === "event") {
      log(`[event] ${msg.event} ${JSON.stringify(msg.data || {}).substring(0, 500)}`);
    }
  });

  // Bind connector
  const bindRes = await call("session.bindConnector", { sessionId: SESSION_ID, connectorId: CONNECTOR_ID });
  log(`✓ Bound connector (connected=${bindRes.connected})`);

  // Plan
  const planRes = await call("agent.plan", { sessionId: SESSION_ID, prompt: PROMPT, platform: "wecom" });
  planId = planRes ? planRes.planId : null;
  log(`✓ Plan created: ${planId}`);

  // Execute
  log("⏳ Executing (may take ~30s while browser searches)…");
  const execRes = await call("agent.execute", { sessionId: SESSION_ID, planId, approved: true });
  log(`✓ Execute returned: ${JSON.stringify(execRes || {}).substring(0, 300)}`);

  // Give time for agent.rendered event
  await new Promise(res => setTimeout(res, 3_000));

  ws.close();
  log("✅ Done");
}

run().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
