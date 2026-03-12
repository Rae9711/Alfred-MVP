/**
 * E2E test for browser.extract_page (WebSocket protocol)
 *
 * Flow:
 *  1. Bind connector (rae-mac)
 *  2. Open BBC News via browser.open_page
 *  3. Wait for agent.rendered (page opened)
 *  4. Run "Summarize the current page" → expects browser.extract_page
 *  5. Wait for agent.rendered with a summary (not raw HTML)
 *
 * Usage: node test-extract-page.cjs
 */
"use strict";
const WebSocket = require("ws");

const WS_URL = "ws://localhost:8080";
const CONNECTOR_ID = "rae-mac";
let msgId = 1;
let startTime = Date.now();

function log(msg) {
  console.log(`[${((Date.now() - startTime) / 1000).toFixed(1)}s] ${msg}`);
}

function makeSession(ws) {
  const sessionId = `test-ep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const pending = {};
  function call(method, params, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const id = String(msgId++);
      pending[id] = { resolve, reject };
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending[id]) { delete pending[id]; reject(new Error(`Timeout: ${method}`)); }
      }, timeoutMs);
    });
  }
  function dispatch(msg) {
    if (msg.id && pending[msg.id]) {
      const cb = pending[msg.id]; delete pending[msg.id];
      msg.ok !== false ? cb.resolve(msg.result) : cb.reject(new Error(msg.error || "rpc error"));
    }
  }
  return { sessionId, call, dispatch };
}

function waitForEvent(ws, targetEvent, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for: ${targetEvent}`)), timeoutMs);
    const listener = (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg.type === "event" && msg.event === targetEvent) {
        clearTimeout(timer); ws.off("message", listener); resolve(msg.data);
      }
    };
    ws.on("message", listener);
  });
}

async function runPhase(ws, session, prompt, label) {
  log(`\n[${label}] prompt: "${prompt}"`);
  const renderedPromise = waitForEvent(ws, "agent.rendered", 120000);

  const planRes = await session.call("agent.plan", { sessionId: session.sessionId, prompt, platform: "wecom" });
  const planId = planRes?.planId ?? planRes?.plan?.planId ?? null;
  log(`  plan id: ${planId}`);

  await session.call("agent.execute", { sessionId: session.sessionId, planId, approved: true });

  const rendered = await renderedPromise;
  log(`  agent.rendered received`);
  return rendered;
}

async function main() {
  console.log("=== browser.extract_page E2E test ===\n");

  const ws = new WebSocket(WS_URL);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  log("Connected");

  const session = makeSession(ws);
  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
    session.dispatch(msg);
    if (msg.type === "event") log(`[event] ${msg.event} ${JSON.stringify(msg.data || {}).substring(0, 300)}`);
  });

  const bindRes = await session.call("session.bindConnector", {
    sessionId: session.sessionId,
    connectorId: CONNECTOR_ID,
  });
  log(`Bound connector (connected=${bindRes?.connected})`);

  // Phase 1: open a real page
  await runPhase(ws, session, "Open https://www.bbc.com/news", "open_page");

  log("waiting 3s for page to load...");
  await new Promise((r) => setTimeout(r, 3000));

  // Phase 2: extract + summarize
  const t0 = Date.now();
  const extractRendered = await runPhase(ws, session, "Summarize the current page", "extract_page");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const renderedText = typeof extractRendered === "string"
    ? extractRendered
    : (extractRendered?.text ?? extractRendered?.markdown ?? JSON.stringify(extractRendered ?? ""));

  console.log("\n=== Results ===");
  console.log("Elapsed:", elapsed + "s");
  console.log("Rendered length:", renderedText.length, "chars");
  console.log("Preview:\n", renderedText.substring(0, 600));

  let passed = true;
  if (renderedText.length < 30) { console.error("FAIL: rendered response too short"); passed = false; }
  if (renderedText.includes("<!DOCTYPE") || renderedText.includes("<html")) {
    console.error("FAIL: rendered response is raw HTML, not a summary"); passed = false;
  }
  if (passed) console.log(`\nPASS: browser.extract_page works end-to-end (${elapsed}s)`);

  ws.close();
  process.exit(passed ? 0 : 1);
}

main().catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
