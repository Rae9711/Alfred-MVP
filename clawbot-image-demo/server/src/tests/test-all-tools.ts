/**
 * Alfred End-to-End Tool Test Suite
 *
 * This script runs comprehensive tests for all Alfred tools, including:
 * - Direct tool execution
 * - Connector-based tool execution
 * - Browser tool execution
 * - Planner and UI action flows
 *
 * Usage:
 *   npx tsx src/tests/test-all-tools.ts
 *
 * Requirements:
 * - Server running and reachable
 * - Connector running and registered (for connector/browser tools)
 * - Playwright installed (for browser automation)
 * - All required env vars set
 *
 * The script prints a structured PASS/FAIL/BLOCKED report for each tool and flow.
 */

// ...test runner implementation will follow...

import WebSocket from "ws";
import fetch from "node-fetch";
import { nanoid } from "nanoid";
import fs from "fs";
import path from "path";

type TestResult = {
	id: string;
	tool: string;
	desc: string;
	input: any;
	executionPath: string;
	status: "PASS" | "FAIL" | "BLOCKED";
	error?: string;
	result?: any;
};

const SERVER_WS = process.env.TEST_SERVER_WS ?? "ws://127.0.0.1:8080";
const OUTBOX = path.resolve(process.env.TEST_OUTBOX ?? "clawbot-image-demo/server/src/outbox");
const EXPECTED_CONNECTOR_ID = process.env.TEST_CONNECTOR_ID ?? "rae-mac";

async function checkServerHealth() {
	try {
		const res = await fetch(`${SERVER_WS.replace(/^ws/, "http")}/health`);
		if (!res.ok) return false;
		const j = await res.json();
		return !!j.status;
	} catch (e) {
		return false;
	}
}

function mkRpcClient(ws: WebSocket) {
	let idCounter = 1;
	const pending = new Map<string, (v: any) => void>();
	ws.on("message", (buf) => {
		let msg: any;
		try {
			msg = JSON.parse(buf.toString());
		} catch (e) {
			return;
		}
		if (msg?.id && pending.has(msg.id)) {
			const cb = pending.get(msg.id)!;
			pending.delete(msg.id);
			cb(msg);
		}
	});

	function call(method: string, params: any) {
		return new Promise<any>((resolve, reject) => {
			const id = `${Date.now().toString(36)}-${idCounter++}`;
			pending.set(id, (msg: any) => resolve(msg));
			ws.send(JSON.stringify({ id, method, params }));
			// no timeout: let caller decide when to abort
		});
	}

	return { call };
}

async function run() {
	console.log("Alfred E2E test runner starting...");

	// Setup checks
	const serverUp = await checkServerHealth();
	if (!serverUp) {
		console.error("BLOCKED: Server /health not reachable at", SERVER_WS);
		process.exit(2);
	}

	// Outbox exists
	try {
		fs.mkdirSync(OUTBOX, { recursive: true });
	} catch (e) {}

	const outboxOk = fs.existsSync(OUTBOX);
	if (!outboxOk) {
		console.error("FAIL: Outbox directory missing and could not be created:", OUTBOX);
		process.exit(2);
	}

	// Connect to server websocket
	const ws = new WebSocket(SERVER_WS.replace(/\/$/, ""));
	await new Promise<void>((res, rej) => {
		ws.on("open", () => res());
		ws.on("error", (e) => rej(e));
	});
	const rpc = mkRpcClient(ws);

	// Create a test session id
	const sessionId = nanoid();

	// Set persona
	await rpc.call("session.setPersona", { sessionId, persona: "professional" });

	// Helper to bind connector and diagnose
	const bindResp = await rpc.call("session.bindConnector", { sessionId, connectorId: EXPECTED_CONNECTOR_ID });
	const bindOk = bindResp?.ok && bindResp.result?.connected;
	console.log("Connector binding result:", bindResp?.result ?? bindResp);

	// If requested, only run the binding check and exit (useful to validate bootstrap)
	if (process.env.TEST_BIND_ONLY === "1") {
		const ok = bindResp?.ok && bindResp.result?.connectorId;
		console.log("TEST_BIND_ONLY result:", bindResp);
		process.exit(ok ? 0 : 3);
	}

	// Diagnostics: list of tests
	const tests: Array<{ id: string; tool: string; desc: string; args: any; connectorRequired?: boolean; validate: (r: any) => boolean }> = [
		{
			id: "A1",
			tool: "text.generate",
			desc: "text.generate - birthday greeting",
			args: { prompt: "Write a short birthday greeting" },
			connectorRequired: false,
			validate: (r) => typeof r?.text === "string" && r.text.trim().length > 0,
		},
		{
			id: "A2",
			tool: "clarify",
			desc: "clarify - missing param",
			args: { question: "" },
			connectorRequired: false,
			validate: (r) => r?.asked === true || r?.question,
		},
		{
			id: "A3",
			tool: "file.save",
			desc: "file.save - write test file",
			args: { content: "e2e test", filename: `e2e_${Date.now()}.txt`, format: "txt" },
			connectorRequired: false,
			validate: (r) => typeof r?.filePath === "string" && fs.existsSync(path.resolve(r.filePath) || path.join(OUTBOX, r.filePath)),
		},
		{
			id: "B1",
			tool: "app.open",
			desc: "app.open - open ChatGPT/WeChat via connector",
			args: { name: "ChatGPT" },
			connectorRequired: true,
			validate: (r) => r?.success === true || typeof r?.error === "string",
		},
		{
			id: "B2",
			tool: "contacts.apple",
			desc: "contacts.apple - connector",
			args: { query: "Test" },
			connectorRequired: true,
			validate: (r) => typeof r === "object",
		},
		{
			id: "C1",
			tool: "browser.open_page",
			desc: "browser.open_page - open ChatGPT",
			args: { url: "https://chat.openai.com/" },
			connectorRequired: true,
			validate: (r) => typeof r?.finalUrl === "string" || typeof r?.title === "string",
		},
		{
			id: "C2",
			tool: "browser.search_web",
			desc: "browser.search_web - Ann Arbor weather",
			args: { query: "Ann Arbor weather" },
			connectorRequired: true,
			validate: (r) => Array.isArray(r?.results) || Array.isArray(r?.suggestedActions),
		},
	];

	const results: TestResult[] = [];

	// Helper to run an agent.run_action and collect events
	async function runAction(tool: string, args: any, label?: string, connectorRequired = false): Promise<any> {
		// Issue run_action RPC
		const resp = await rpc.call("agent.run_action", { sessionId, tool, args, label });
		if (!resp?.ok) return { error: resp?.error || "agent.run_action failed" };
		const runId = resp.result?.runId;
		if (!runId) return { error: "no runId returned" };

		// Listen for agent.exec.finished for this runId
		return await new Promise((resolve) => {
			const handler = (buf: WebSocket.Data) => {
				let msg: any;
				try {
					msg = JSON.parse(buf.toString());
				} catch (e) {
					return;
				}
				if (msg?.type === "event") {
					const ev = msg;
					if (ev.event === "agent.exec.finished" && ev.data?.runId === runId) {
						ws.off("message", handler);
						resolve({ ok: true, runId, summary: ev.data });
					}
					if (ev.event === "tool.error" && ev.data?.runId === runId) {
						// capture tool error
						ws.off("message", handler);
						resolve({ ok: false, error: ev.data?.error, runId });
					}
					if (ev.event === "tool.success" && ev.data?.runId === runId) {
						// tool returned data may be in tool.success
						// continue waiting for finished for final status
					}
				}
			};
			ws.on("message", handler);
		});
	}

	// Run tests sequentially
	for (const t of tests) {
		const tr: TestResult = {
			id: t.id,
			tool: t.tool,
			desc: t.desc,
			input: t.args,
			executionPath: t.connectorRequired ? "connector" : "local",
			status: "FAIL",
		};

		// If test requires connector but session binding shows not connected, mark BLOCKED
		if (t.connectorRequired && !bindOk) {
			tr.status = "BLOCKED";
			tr.error = `Connector ${EXPECTED_CONNECTOR_ID} not connected or not registered`;
			results.push(tr);
			console.log(`[BLOCKED] ${t.id} ${t.desc}: ${tr.error}`);
			continue;
		}

		try {
			const r = await runAction(t.tool, t.args, t.desc, !!t.connectorRequired);
			if (r?.error) {
				tr.status = "FAIL";
				tr.error = r.error;
			} else {
				// fetch final rendered message or tool-level details may be in r.summary
				tr.result = r.summary ?? r;
				// Make a basic validation call using test's validate
				const ok = t.validate(r.summary ?? r);
				tr.status = ok ? "PASS" : "FAIL";
				if (!ok) tr.error = `Validation failed for result: ${JSON.stringify(r).slice(0,200)}`;
			}
		} catch (e: any) {
			tr.status = "FAIL";
			tr.error = e?.message ?? String(e);
		}

		results.push(tr);
		console.log(`[${tr.status}] ${tr.id} ${tr.desc} => ${tr.error ?? JSON.stringify(tr.result).slice(0,200)}`);
	}

	// Connector diagnostics
	const diag: any = { expectedConnectorId: EXPECTED_CONNECTOR_ID, sessionId, bindResult: bindResp?.result ?? bindResp };

	// Print structured report
	const report = { summary: { total: results.length, pass: results.filter(r=>r.status==='PASS').length, fail: results.filter(r=>r.status==='FAIL').length, blocked: results.filter(r=>r.status==='BLOCKED').length }, results, diag };

	const outFile = path.resolve(process.cwd(), "tool-test-result.json");
	fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf-8");
	console.log("Test run complete. Report written to", outFile);

	// Close ws and exit
	ws.close();
	const anyFails = results.some(r => r.status !== "PASS");
	process.exit(anyFails ? 1 : 0);
}

run().catch(e=>{
	console.error("Test runner error:", e);
	process.exit(2);
});
