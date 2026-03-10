/**
 * WeChat Bridge Connector
 *
 * Connects to Alfred's server via WebSocket and uses Wechaty to send
 * WeChat messages. On startup it displays a QR code in the terminal
 * for WeChat login.
 *
 * Usage:
 *   CONNECTOR_ID=my-wechat npm run wechat
 *
 * Environment variables:
 *   CONNECTOR_ID          - Required. Unique connector identifier.
 *   CONNECTOR_SERVER_WS   - Server WebSocket URL (default: ws://127.0.0.1:8080)
 *   CONNECTOR_TOKEN       - Optional auth token for connector registration.
 *   WECHATY_PUPPET        - Puppet provider (default: wechaty-puppet-wechat).
 *                           Set to "wechaty-puppet-padlocal" for PadLocal.
 *   WECHATY_TOKEN         - Token for paid puppets like PadLocal.
 */

import WebSocket from "ws";
import { nanoid } from "nanoid";
import { WechatyBuilder, type Wechaty, type Contact } from "wechaty";

// @ts-ignore — qrcode-terminal has no type declarations
import qrcodeTerminal from "qrcode-terminal";

// ── config ──────────────────────────────────────────────

const SERVER_WS_URL = process.env.CONNECTOR_SERVER_WS ?? "ws://127.0.0.1:8080";
const CONNECTOR_ID = (process.env.CONNECTOR_ID ?? "").trim();
const CONNECTOR_TOKEN = process.env.CONNECTOR_TOKEN;
const RECONNECT_DELAY_MS = 3_000;

const PUPPET_NAME = process.env.WECHATY_PUPPET ?? "wechaty-puppet-wechat";
const PUPPET_TOKEN = process.env.WECHATY_TOKEN;

if (!CONNECTOR_ID) {
  console.error("[wechat-bridge] Missing CONNECTOR_ID");
  console.error("Usage: CONNECTOR_ID=my-wechat npm run wechat");
  process.exit(1);
}

// ── Wechaty instance ────────────────────────────────────

let bot: Wechaty;
let botReady = false;

async function startBot() {
  const puppetOptions: Record<string, any> = {};
  if (PUPPET_TOKEN) {
    puppetOptions.token = PUPPET_TOKEN;
  }

  bot = WechatyBuilder.build({
    name: `alfred-wechat-${CONNECTOR_ID}`,
    puppet: PUPPET_NAME as any,
    puppetOptions,
  });

  bot.on("scan", (qrcode, status) => {
    console.log("\n[wechat-bridge] Scan the QR code below to log in to WeChat:\n");
    qrcodeTerminal.generate(qrcode, { small: true });
    console.log(`\nStatus: ${status}\n`);
  });

  bot.on("login", (user) => {
    console.log(`[wechat-bridge] Logged in as: ${user.name()}`);
    botReady = true;
  });

  bot.on("logout", (user) => {
    console.log(`[wechat-bridge] Logged out: ${user.name()}`);
    botReady = false;
  });

  bot.on("error", (error) => {
    console.error("[wechat-bridge] Bot error:", error.message);
  });

  console.log("[wechat-bridge] Starting Wechaty...");
  await bot.start();
}

// ── find contact helper ─────────────────────────────────

async function findContact(nameOrAlias: string): Promise<Contact | null> {
  const query = nameOrAlias.trim();
  if (!query) return null;

  // Try exact name match first
  const byName = await bot.Contact.find({ name: query });
  if (byName) return byName;

  // Try alias (remark name) match
  const byAlias = await bot.Contact.find({ alias: query });
  if (byAlias) return byAlias;

  // Try fuzzy search — get all contacts and find partial match
  const all = await bot.Contact.findAll();
  const lower = query.toLowerCase();
  const fuzzy = all.find((c) => {
    const n = (c.name() ?? "").toLowerCase();
    const a = ((c as any).alias?.() ?? "").toLowerCase();
    return n.includes(lower) || a.includes(lower);
  });

  return fuzzy ?? null;
}

// ── handle wechat.send ──────────────────────────────────

async function handleWechatSend(args: {
  recipient?: string;
  message?: string;
}): Promise<any> {
  const recipient = (args.recipient ?? "").trim();
  const message = (args.message ?? "").trim();

  if (!recipient) {
    return { error: "wechat.send requires a non-empty recipient" };
  }
  if (!message) {
    return { error: "wechat.send requires a non-empty message" };
  }

  if (!botReady) {
    return { error: "WeChat bot is not logged in. Please scan the QR code first." };
  }

  const contact = await findContact(recipient);
  if (!contact) {
    return { error: `Contact not found: "${recipient}". Make sure they are in your WeChat contacts.` };
  }

  await contact.say(message);

  return {
    sent: true,
    recipient: contact.name(),
    message,
  };
}

// ── WebSocket connector to Alfred server ────────────────

function call(ws: WebSocket, method: string, params: any) {
  ws.send(
    JSON.stringify({
      id: nanoid(10),
      method,
      params,
    }),
  );
}

function connectToServer() {
  const ws = new WebSocket(SERVER_WS_URL);

  ws.on("open", () => {
    console.log(`[wechat-bridge] Connected to server: ${SERVER_WS_URL}`);
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

    // Registration response
    if (typeof msg?.id === "string" && typeof msg?.ok === "boolean") {
      if (msg.ok) {
        console.log("[wechat-bridge] Registered with server as:", msg.result?.connectorId ?? CONNECTOR_ID);
      } else {
        console.error("[wechat-bridge] Registration failed:", msg.error ?? "unknown");
      }
      return;
    }

    // Replaced by another connector
    if (msg?.type === "event" && msg?.event === "connector.replaced") {
      console.warn("[wechat-bridge] Replaced by another connection, closing");
      try { ws.close(); } catch { /* ignore */ }
      return;
    }

    // Tool invocation
    if (msg?.type !== "connector.invoke") return;

    const requestId = msg?.data?.requestId;
    const toolId = msg?.data?.tool;
    const args = msg?.data?.args ?? {};

    if (!requestId || !toolId) return;

    // Only handle wechat.send
    if (toolId !== "wechat.send") {
      call(ws, "connector.result", {
        requestId,
        ok: false,
        error: `WeChat bridge does not handle tool: ${toolId}`,
      });
      return;
    }

    try {
      const result = await handleWechatSend(args);
      const hasError = "error" in result;
      call(ws, "connector.result", {
        requestId,
        ok: !hasError,
        ...(hasError ? { error: result.error } : { result }),
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
    console.warn(`[wechat-bridge] Disconnected from server, retrying in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(connectToServer, RECONNECT_DELAY_MS);
  });

  ws.on("error", (e) => {
    console.error("[wechat-bridge] WebSocket error:", (e as any)?.message ?? e);
  });
}

// ── main ────────────────────────────────────────────────

async function main() {
  // Start Wechaty bot (QR code will appear in terminal)
  await startBot();

  // Connect to Alfred server as a connector
  connectToServer();
}

main().catch((err) => {
  console.error("[wechat-bridge] Fatal error:", err);
  process.exit(1);
});
