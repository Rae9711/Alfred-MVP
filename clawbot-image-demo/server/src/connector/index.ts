import path from "path";
import fs from "fs";
import WebSocket from "ws";
import { nanoid } from "nanoid";
import { getTool } from "../agent/tools/registry.js";
import "../agent/tools/index.js";
import { isBrowserTool, executeBrowserTool } from "./browserTools/index.js";
import { openApp } from "./appTools/openApp.js";

const SERVER_WS_URL = process.env.CONNECTOR_SERVER_WS ?? "ws://127.0.0.1:8080";
const CONNECTOR_ID = (process.env.CONNECTOR_ID ?? "").trim();
const CONNECTOR_TOKEN = process.env.CONNECTOR_TOKEN;
const RECONNECT_DELAY_MS = 2_000;

if (!CONNECTOR_ID) {
  console.error("[connector] missing CONNECTOR_ID");
  console.error("Example: CONNECTOR_ID=rae-mac CONNECTOR_SERVER_WS=ws://cloud-host:8080 npm run connector");
  process.exit(1);
}

const outboxDir = path.resolve("src/outbox");
fs.mkdirSync(outboxDir, { recursive: true });

function call(ws: WebSocket, method: string, params: any) {
  ws.send(
    JSON.stringify({
      id: nanoid(10),
      method,
      params,
    }),
  );
}

function connect() {
  const ws = new WebSocket(SERVER_WS_URL);

  ws.on("open", () => {
    console.log(`[connector] connected to ${SERVER_WS_URL}`);
    call(ws, "connector.register", {
      connectorId: CONNECTOR_ID,
      token: CONNECTOR_TOKEN,
    });
  });

  ws.on("message", async (buf) => {
    let msg: any;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    if (typeof msg?.id === "string" && typeof msg?.ok === "boolean") {
      if (msg.ok) {
        console.log("[connector] register ok:", msg.result?.connectorId ?? CONNECTOR_ID);
      } else {
        console.error("[connector] register failed:", msg.error ?? "unknown error");
      }
      return;
    }

    if (msg?.type === "event" && msg?.event === "connector.replaced") {
      console.warn("[connector] replaced by another connection, closing current socket");
      try {
        ws.close();
      } catch {
        // ignore
      }
      return;
    }

    if (msg?.type !== "connector.invoke") return;

    const requestId = msg?.data?.requestId;
    const toolId = msg?.data?.tool;
    const args = msg?.data?.args ?? {};

    if (!requestId || !toolId) {
      return;
    }

    // Handle app.open locally via macOS `open -a`
    if (toolId === "app.open") {
      console.log(`[connector] app.open: name=${JSON.stringify(args.name)}`);
      try {
        const result = await openApp(args as any);
        call(ws, "connector.result", { requestId, ok: true, result });
      } catch (e: any) {
        call(ws, "connector.result", { requestId, ok: false, error: e?.message || String(e) });
      }
      return;
    }

    // Handle browser tools via Playwright
    if (isBrowserTool(toolId)) {
      console.log(`[connector] received ${toolId} request`, {
        requestId,
        origin: args?.origin,
        destination: args?.destination,
        date: args?.date,
      });
      console.log(`[connector] Executing browser tool: ${toolId}`);
      try {
        const result = await executeBrowserTool(toolId, args);
        if (toolId === "browser.search_flights") {
          const count = Array.isArray(result?.flights) ? result.flights.length : 0;
          console.log(`[connector] browser.search_flights returned ${count} flights`);
        }
        call(ws, "connector.result", {
          requestId,
          ok: true,
          result,
        });
      } catch (e: any) {
        call(ws, "connector.result", {
          requestId,
          ok: false,
          error: e?.message || String(e),
        });
      }
      return;
    }

    // Handle other tools via registry
    const tool = getTool(toolId);
    if (!tool) {
      call(ws, "connector.result", {
        requestId,
        ok: false,
        error: `Tool not found on connector: ${toolId}`,
      });
      return;
    }

    // Whitelist check for non-browser tools
    const ALLOWED_REGISTRY_TOOLS = new Set(["contacts.apple", "imessage.send"]);
    if (!ALLOWED_REGISTRY_TOOLS.has(toolId)) {
      call(ws, "connector.result", {
        requestId,
        ok: false,
        error: `Tool not allowed on connector: ${toolId}`,
      });
      return;
    }

    try {
      const result = await tool.execute(args, {
        outboxDir,
        vars: {},
      });
      call(ws, "connector.result", {
        requestId,
        ok: true,
        result,
      });
    } catch (e: any) {
      call(ws, "connector.result", {
        requestId,
        ok: false,
        error: e?.message || String(e),
      });
    }
  });

  ws.on("close", () => {
    console.warn(`[connector] disconnected, retrying in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on("error", (e) => {
    console.error("[connector] socket error:", (e as any)?.message ?? e);
  });
}

connect();
