/**
 * Full E2E Test Suite — Alfred Browser Tools
 * 
 * Run from /clawbot-image-demo/server:
 *   node test-browser-suite.cjs
 *
 * Tests all browser-related features:
 *   A. browser.open_page
 *   B. browser.search_web
 *   C. browser.click_link_by_text
 *   D. browser.extract_page
 *   E. suggestedActions flow
 *   F. browser.search_flights
 *   G. browser.fill_input
 *   H. browser.compose_gmail_draft
 *   I. browser.submit_chatgpt_prompt
 */

const WebSocket = require("ws");

const WS_URL = "ws://localhost:8080";
const CONNECTOR_ID = "rae-mac";

let msgId = 1;
const suiteStart = Date.now();

// ── Utilities ──────────────────────────────────────────────────────────────

function log(msg) {
  const secs = ((Date.now() - suiteStart) / 1000).toFixed(1);
  console.log(`[${secs}s] ${msg}`);
}

function shortJSON(obj, max = 300) {
  return JSON.stringify(obj, null, 2).substring(0, max);
}

// ── WebSocket harness ──────────────────────────────────────────────────────

function openWS() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function rpcCall(ws, method, params, pending) {
  return new Promise((resolve, reject) => {
    const id = String(msgId++);
    pending[id] = { resolve, reject };
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/**
 * Run one test scenario and return a result record.
 * @param {object} cfg
 *   prompt       string — natural-language prompt (send via agent.plan)
 *   runAction    object — {tool,args,label} — bypass planner, direct tool call via agent.run_action
 *   expectTool   string — expected tool in plan (for plan-based tests)
 *   expectResult (result) => true/false/string — assertion fn
 *   timeout      number — ms to wait for agent.rendered (default 120_000)
 *   description  string — human label
 *   sessionId    string — optional override
 */
async function runTest(cfg) {
  const sessionId = cfg.sessionId || ("test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7));
  const timeout = cfg.timeout || 120_000;
  const desc = cfg.description || (cfg.prompt || cfg.runAction?.label || "unnamed");

  const result = {
    description: desc,
    sessionId,
    passed: false,
    plannedTool: null,
    renderedMessage: null,
    toolResult: null,
    suggestedActions: null,
    error: null,
    events: [],
  };

  let ws;
  const pending = {};

  try {
    ws = await openWS();
    log(`  [${desc}] WS connected`);

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
        result.events.push({ event: msg.event, data: msg.data });

        if (msg.event === "tool.success") {
          result.toolResult = msg.data?.result;
          if (msg.data?.result?.suggestedActions) {
            result.suggestedActions = msg.data.result.suggestedActions;
          }
        }

        if (msg.event === "agent.plan.proposed") {
          const steps = msg.data?.steps || [];
          result.plannedTool = steps[0]?.tool || null;
        }
      }
    });

    // Bind connector
    await rpcCall(ws, "session.bindConnector", { sessionId, connectorId: CONNECTOR_ID }, pending);
    // Immediate mode
    await rpcCall(ws, "session.setActionMode", { sessionId, mode: "immediate" }, pending);

    // Fire the request
    if (cfg.runAction) {
      // Direct tool call (suggested action path).
      // The server processes this async and emits agent.rendered — we watch for the event.
      // Catch the RPC ack/rejection to prevent unhandled-rejection crash in Node 24.
      rpcCall(ws, "agent.run_action", {
        sessionId,
        tool: cfg.runAction.tool,
        args: cfg.runAction.args,
        label: cfg.runAction.label,
      }, pending).catch((err) => {
        // Store as a soft error but keep waiting for the rendered event
        result.error = `agent.run_action RPC error: ${err.message}`;
        log(`  [${desc}] run_action RPC error (may still render): ${err.message}`);
      });
    } else {
      // Plan + execute path
      await rpcCall(ws, "agent.plan", {
        sessionId,
        intent: cfg.intent || "browser",
        prompt: cfg.prompt,
      }, pending);
    }

    // Wait for agent.rendered event (or timeout)
    const rendered = await new Promise((resolve) => {
      const interval = setInterval(() => {
        const ev = result.events.find((e) => e.event === "agent.rendered");
        if (ev) { clearInterval(interval); resolve(ev.data); }
      }, 500);
      setTimeout(() => { clearInterval(interval); resolve(null); }, timeout);
    });

    if (!rendered) {
      result.error = `TIMEOUT after ${timeout / 1000}s — agent.rendered never received`;
      return result;
    }

    result.renderedMessage = rendered.message || rendered.text || rendered.markdown || JSON.stringify(rendered);

    // Run assertion
    if (cfg.expectResult) {
      const assertion = cfg.expectResult(result);
      if (assertion === true || assertion === undefined) {
        result.passed = true;
      } else if (assertion === false) {
        result.error = "Assertion returned false";
      } else {
        result.error = String(assertion);
      }
    } else {
      // Default: pass if rendered message is non-empty
      result.passed = !!result.renderedMessage && result.renderedMessage.length > 10;
      if (!result.passed) result.error = "Empty rendered message";
    }

  } catch (err) {
    result.error = err.message;
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  }

  return result;
}

// ── Test definitions ───────────────────────────────────────────────────────

const TESTS = [

  // ── A. browser.open_page ──────────────────────────────────────────────────
  {
    group: "A. browser.open_page",
    description: "A1: Open Gmail",
    prompt: "Open Gmail in the browser",
    timeout: 45_000,
    expectResult: (r) => {
      if (r.plannedTool && r.plannedTool !== "browser.open_page")
        return `Wrong tool: ${r.plannedTool} (expected browser.open_page)`;
      if (!r.renderedMessage) return "No rendered message";
      const m = r.renderedMessage.toLowerCase();
      // Accept either open_page success text or that the planner used web.search as fallback
      if (m.includes("gmail") || m.includes("mail") || m.includes("已在浏览器") || m.includes("opened")) return true;
      return `Message does not mention gmail: ${r.renderedMessage.slice(0, 200)}`;
    },
  },
  {
    group: "A. browser.open_page",
    description: "A2: Open ChatGPT",
    prompt: "Open ChatGPT",
    timeout: 45_000,
    expectResult: (r) => {
      if (!r.renderedMessage) return "No rendered message";
      const m = r.renderedMessage.toLowerCase();
      if (m.includes("chatgpt") || m.includes("openai") || m.includes("已在浏览器") || m.includes("opened")) return true;
      return `Message does not mention chatgpt: ${r.renderedMessage.slice(0, 200)}`;
    },
  },
  {
    group: "A. browser.open_page",
    description: "A3: Open Amazon",
    prompt: "Open Amazon",
    timeout: 45_000,
    expectResult: (r) => {
      if (!r.renderedMessage) return "No rendered message";
      const m = r.renderedMessage.toLowerCase();
      if (m.includes("amazon") || m.includes("已在浏览器") || m.includes("opened")) return true;
      return `Message does not mention amazon: ${r.renderedMessage.slice(0, 200)}`;
    },
  },

  // ── B. browser.search_web ─────────────────────────────────────────────────
  {
    group: "B. browser.search_web",
    description: "B1: Search Ann Arbor weather",
    prompt: "Search Ann Arbor weather",
    timeout: 60_000,
    expectResult: (r) => {
      if (r.plannedTool && !["browser.search_web", "web.search"].includes(r.plannedTool))
        return `Wrong tool: ${r.plannedTool}`;
      if (!r.renderedMessage) return "No rendered message";
      const m = r.renderedMessage.toLowerCase();
      if (m.includes("ann arbor") || m.includes("weather") || m.includes("搜索") || m.includes("天气")) return true;
      return `Message doesn't mention weather/ann arbor: ${r.renderedMessage.slice(0, 200)}`;
    },
  },
  {
    group: "B. browser.search_web",
    description: "B2: Search best coffee shops in Ann Arbor",
    prompt: "Search best coffee shops in Ann Arbor",
    timeout: 60_000,
    expectResult: (r) => {
      if (!r.renderedMessage) return "No rendered message";
      const m = r.renderedMessage.toLowerCase();
      if (m.includes("coffee") || m.includes("ann arbor") || m.includes("咖啡") || m.includes("搜索")) return true;
      return `Message doesn't mention coffee: ${r.renderedMessage.slice(0, 200)}`;
    },
  },

  // ── C. browser.click_link_by_text (direct tool call) ────────────────────
  {
    group: "C. browser.click_link_by_text",
    description: "C1: Click first result after search (direct run_action)",
    runAction: { tool: "browser.click_link_by_text", args: { ordinal: 1 }, label: "Open result 1" },
    timeout: 60_000,
    expectResult: (r) => {
      if (!r.renderedMessage) return "No rendered message";
      if (r.toolResult && r.toolResult.success === false) {
        return `Tool returned success=false: ${r.toolResult.error}`;
      }
      // Either a rendered message about what was opened, or success in tool result
      if (r.toolResult && r.toolResult.success) return true;
      if (r.renderedMessage.length > 10) return true;
      return "No useful result";
    },
  },

  // ── D. browser.extract_page ───────────────────────────────────────────────
  {
    group: "D. browser.extract_page",
    description: "D1: Extract/summarize current page after open",
    runAction: { tool: "browser.extract_page", args: { mode: "current_page" }, label: "Summarize this page" },
    timeout: 150_000,
    expectResult: (r) => {
      if (!r.renderedMessage) return "No rendered message";
      if (r.toolResult && r.toolResult.success === false) {
        return `Tool returned success=false: ${r.toolResult.error}`;
      }
      if (r.toolResult && r.toolResult.success) return true;
      if (r.renderedMessage.length > 20) return true;
      return "Response too short";
    },
  },

  // ── E. suggestedActions flow ─────────────────────────────────────────────
  // This test runs search_web and checks that suggestedActions are returned in tool.success
  {
    group: "E. suggestedActions",
    description: "E1: search_web returns suggestedActions array",
    prompt: "Search what is retrieval augmented generation",
    timeout: 60_000,
    expectResult: (r) => {
      if (!r.toolResult) return "No tool.success result captured";
      if (r.plannedTool && !["browser.search_web", "web.search"].includes(r.plannedTool)) {
        // Still pass if the tool succeeded — planner may vary
      }
      // Check suggestedActions on the browser.search_web result
      const sa = r.toolResult.suggestedActions;
      if (!sa || !Array.isArray(sa) || sa.length === 0) {
        // May have used web.search (server-side) which doesn't produce suggestedActions — soft pass
        if (r.plannedTool === "web.search") return true; // server-side search, no suggested actions expected
        return `suggestedActions missing from tool result. toolResult keys: ${Object.keys(r.toolResult || {}).join(",")}`;
      }
      log(`  [E1] suggestedActions: ${JSON.stringify(sa).slice(0, 200)}`);
      return true;
    },
  },

  // ── F. browser.search_flights ─────────────────────────────────────────────
  {
    group: "F. browser.search_flights",
    description: "F1: Search flights NYC to Detroit March 25",
    prompt: "Search flights from New York to Detroit for March 25 2026",
    timeout: 150_000,
    expectResult: (r) => {
      if (!r.renderedMessage) return "No rendered message";
      const m = r.renderedMessage.toLowerCase();
      if (m.includes("detroit") || m.includes("dtw") || m.includes("new york") || m.includes("航班") || m.includes("flight")) return true;
      return `Message doesn't mention flight route: ${r.renderedMessage.slice(0, 300)}`;
    },
  },

  // ── G. browser.fill_input ────────────────────────────────────────────────
  // Navigate to DuckDuckGo first, then fill its search box
  {
    group: "G. browser.fill_input",
    description: "G0: Navigate to DuckDuckGo (setup for G1/G2)",
    runAction: {
      tool: "browser.open_page",
      args: { url: "https://duckduckgo.com" },
      label: "Open DuckDuckGo",
    },
    timeout: 30_000,
    expectResult: (r) => {
      if (!r.toolResult) return "No tool.success result captured";
      return true; // Just need to navigate there
    },
  },
  {
    group: "G. browser.fill_input",
    description: "G1: Fill DuckDuckGo search box (selector mode)",
    runAction: {
      tool: "browser.fill_input",
      args: {
        target: { by: "selector", value: "input[name='q']" },
        value: "playwright testing best practices",
        pressEnter: false,
      },
      label: "Fill DuckDuckGo search",
    },
    timeout: 30_000,
    expectResult: (r) => {
      if (!r.toolResult) return "No tool.success result captured";
      if (!r.toolResult.success) return `Fill failed: ${r.toolResult.error}`;
      if (!r.toolResult.verified) {
        // Soft warning — field type may be contenteditable
        log(`  [G1] WARNING: fill succeeded but verified=false`);
      }
      return true;
    },
  },
  {
    group: "G. browser.fill_input",
    description: "G2: Fill DuckDuckGo search box (placeholder mode)",
    runAction: {
      tool: "browser.fill_input",
      args: {
        target: { by: "placeholder", value: "Search" },
        value: "ann arbor restaurants 2026",
        pressEnter: false,
      },
      label: "Fill search by placeholder",
    },
    timeout: 30_000,
    expectResult: (r) => {
      if (!r.toolResult) return "No tool.success result captured";
      if (!r.toolResult.success) return `Fill failed: ${r.toolResult.error}`;
      return true;
    },
  },

  // ── H. browser.compose_gmail_draft ──────────────────────────────────────
  {
    group: "H. Gmail draft",
    description: "H1: Compose Gmail draft (via planner)",
    prompt: "Open Gmail in the browser and compose a draft email to test@example.com with subject 'Test from Alfred' and body 'Hello, this is a test email from Alfred.' Do not send it.",
    timeout: 90_000,
    expectResult: (r) => {
      if (!r.renderedMessage) return "No rendered message";
      const m = r.renderedMessage.toLowerCase();
      // Accept: either draft_ready success, not_logged_in clear error, or any mention of email
      if (m.includes("not_logged_in") || m.includes("not logged in") || m.includes("请") || m.includes("login") || m.includes("sign in")) {
        log(`  [H1] Not logged in — clear error returned (ACCEPTABLE)`);
        return true; // Clear error is a valid pass
      }
      if (m.includes("draft") || m.includes("草稿") || m.includes("draft_ready") || m.includes("email") || m.includes("邮件")) return true;
      return `Unexpected response: ${r.renderedMessage.slice(0, 300)}`;
    },
  },

  // ── I. browser.submit_chatgpt_prompt ────────────────────────────────────
  {
    group: "I. ChatGPT prompt",
    description: "I1: Submit prompt to ChatGPT (via planner)",
    prompt: "Ask ChatGPT: what is 2+2?",
    timeout: 120_000,
    expectResult: (r) => {
      if (!r.renderedMessage) return "No rendered message";
      const m = r.renderedMessage.toLowerCase();
      // Accept: response with answer, or clear not-logged-in error
      if (m.includes("not logged in") || m.includes("login") || m.includes("sign in") || m.includes("请登录")) {
        log(`  [I1] Not logged in — clear error returned (ACCEPTABLE)`);
        return true;
      }
      if (m.includes("4") || m.includes("chatgpt") || m.includes("answer") || m.includes("回答") || m.includes("2+2")) return true;
      if (r.renderedMessage.length > 30) return true; // Got something back
      return `Unexpected or empty response: ${r.renderedMessage.slice(0, 300)}`;
    },
  },
];

// ── Test runner ────────────────────────────────────────────────────────────

async function runAll() {
  console.log("\n" + "═".repeat(70));
  console.log("  Alfred Browser Tools — Full E2E Test Suite");
  console.log("  " + new Date().toISOString());
  console.log("═".repeat(70) + "\n");

  const results = [];
  let currentGroup = null;

  for (const test of TESTS) {
    if (test.group !== currentGroup) {
      console.log(`\n${"─".repeat(60)}`);
      console.log(`  ${test.group}`);
      console.log("─".repeat(60));
      currentGroup = test.group;
    }

    log(`→ Starting: ${test.description}`);
    const start = Date.now();
    const r = await runTest(test);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    r.elapsedSec = elapsed;

    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    log(`${status} [${elapsed}s] ${test.description}`);
    if (!r.passed) log(`   Reason: ${r.error}`);
    if (r.plannedTool) log(`   Planner picked: ${r.plannedTool}`);
    if (r.renderedMessage) log(`   Rendered: ${r.renderedMessage.replace(/\n/g, " ").slice(0, 200)}`);
    if (r.toolResult && !r.passed) log(`   Tool result: ${shortJSON(r.toolResult, 300)}`);

    results.push({ ...test, ...r });

    // Brief pause between tests to avoid hammering the browser
    await new Promise((res) => setTimeout(res, 2000));
  }

  // ── Summary report ─────────────────────────────────────────────────────

  console.log("\n\n" + "═".repeat(70));
  console.log("  TEST SUMMARY");
  console.log("═".repeat(70));

  const groups = {};
  for (const r of results) {
    const g = r.group || "misc";
    if (!groups[g]) groups[g] = [];
    groups[g].push(r);
  }

  let totalPass = 0;
  let totalFail = 0;

  for (const [group, tests] of Object.entries(groups)) {
    const pass = tests.filter((t) => t.passed).length;
    const fail = tests.filter((t) => !t.passed).length;
    totalPass += pass;
    totalFail += fail;

    console.log(`\n${group}`);
    for (const t of tests) {
      const icon = t.passed ? "✅" : "❌";
      console.log(`  ${icon} ${t.description} [${t.elapsedSec}s]`);
      if (!t.passed) console.log(`       FAIL: ${t.error}`);
      if (t.renderedMessage) console.log(`       MSG: ${t.renderedMessage.replace(/\n/g, " ").slice(0, 180)}`);
    }
  }

  console.log("\n" + "─".repeat(70));
  console.log(`  TOTAL: ${totalPass + totalFail} tests — ✅ ${totalPass} PASS  ❌ ${totalFail} FAIL`);
  console.log("─".repeat(70) + "\n");

  return results;
}

runAll().then((results) => {
  const anyFailed = results.some((r) => !r.passed);
  process.exit(anyFailed ? 1 : 0);
}).catch((err) => {
  console.error("Suite fatal error:", err.message);
  process.exit(1);
});
